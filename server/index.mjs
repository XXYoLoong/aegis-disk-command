import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import si from 'systeminformation'
import {
  analyzeCrossDriveWithAi,
  analyzeDriveWithAi,
  chatWithDriveContext,
  getAiRuntimeConfig,
} from './ai-analysis.mjs'
import { createLocalStore } from './local-store.mjs'
import {
  buildFallbackCrossSummary,
  buildFallbackDriveGuidance,
  buildFallbackDriveSummary,
  buildFallbackOpportunities,
  fallbackStandardizationSuggestions,
} from './fallback-analysis.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distRoot = path.join(projectRoot, 'dist')
const scanScript = path.join(__dirname, 'scan-drive.ps1')

const app = express()
const localStore = createLocalStore(projectRoot)

const PORT = Number(process.env.PORT ?? 5525)
const LIVE_REFRESH_MS = 1500
const ANALYSIS_STALE_MS = 1000 * 60 * 8
const MAX_HISTORY_POINTS = 120
const CROSS_DRIVE_AI_DEBOUNCE_MS = 2200

const runtimeSettings = () => localStore.getRuntimeSettings()
const aiRuntime = () => getAiRuntimeConfig(runtimeSettings())
const currentLanguage = () => runtimeSettings().language
const currentReportStyle = () => runtimeSettings().reportStyle
const aiEnabled = () => aiRuntime().enabled

const state = {
  bootedAt: Date.now(),
  generatedAt: new Date().toISOString(),
  system: {
    hostName: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuLoadPercent: 0,
    memoryUsedPercent: 0,
    totalBytes: 0,
    usedBytes: 0,
    freeBytes: 0,
    driveCount: 0,
    queueDepth: 0,
    scanQueueDepth: 0,
    aiQueueDepth: 0,
    activeScan: null,
    activeAi: null,
    historySamples: 0,
    uptimeMinutes: 0,
    analysisEngine: 'rules-only',
    aiEnabled: false,
    aiProvider: '',
    aiModel: null,
    aiStatus: 'disabled',
    aiLastError: null,
    aiLastAnalyzedAt: null,
    selectedProvider: runtimeSettings().providerId,
    language: runtimeSettings().language,
    reportStyle: runtimeSettings().reportStyle,
    setupRequired: localStore.getClientSettings().setupRequired,
  },
  drives: [],
  analyses: new Map(),
  scanQueue: [],
  aiQueue: [],
  crossDriveAi: {
    summary: '',
    standardizationSuggestions: [],
    updatedAt: null,
  },
  crossDrive: {
    duplicateTopLevelNames: [],
    standardizationSuggestions: [],
    topOpportunities: [],
    summary: '',
  },
}

let crossDriveTimer = null
let activeScanChild = null
let activeAiTask = null

app.use(express.json({ limit: '2mb' }))

function bytes(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function readField(source, ...keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) {
      return source[key]
    }
  }
  return undefined
}

function readString(source, ...keys) {
  const value = readField(source, ...keys)
  return typeof value === 'string' ? value : ''
}

function readEntry(source) {
  return {
    name: readString(source, 'name', 'Name'),
    path: readString(source, 'path', 'Path'),
    type: readString(source, 'type', 'Type') || 'file',
    extension: readField(source, 'extension', 'Extension') ?? null,
    sizeBytes: bytes(readField(source, 'sizeBytes', 'SizeBytes')),
  }
}

function readFocusDirectory(source) {
  return {
    name: readString(source, 'name', 'Name'),
    path: readString(source, 'path', 'Path'),
    sizeBytes: bytes(readField(source, 'sizeBytes', 'SizeBytes')),
    children: toArray(readField(source, 'children', 'Children')).map(readEntry),
  }
}

function readStats(source) {
  return {
    rootsCompleted: Number(readField(source, 'rootsCompleted', 'RootsCompleted') ?? 0),
    rootsTotal: Number(readField(source, 'rootsTotal', 'RootsTotal') ?? 0),
    filesVisited: bytes(readField(source, 'filesVisited', 'FilesVisited')),
    directoriesVisited: bytes(readField(source, 'directoriesVisited', 'DirectoriesVisited')),
    bytesSeen: bytes(readField(source, 'bytesSeen', 'BytesSeen')),
    elapsedMs: bytes(readField(source, 'elapsedMs', 'ElapsedMs')),
  }
}

function readProgress(source) {
  const stats = readStats(source)
  return {
    phase: readString(source, 'phase', 'Phase') || 'idle',
    percent: Number(readField(source, 'percent', 'Percent') ?? 0),
    rootsCompleted: stats.rootsCompleted,
    rootsTotal: stats.rootsTotal,
    filesVisited: stats.filesVisited,
    directoriesVisited: stats.directoriesVisited,
    bytesSeen: stats.bytesSeen,
    currentRoot: readField(source, 'currentRoot', 'CurrentRoot') ?? null,
    currentPath: readField(source, 'currentPath', 'CurrentPath') ?? null,
    elapsedMs: stats.elapsedMs,
  }
}

function classifyDriveHealth(usePercent) {
  if (usePercent >= 92) return 'critical'
  if (usePercent >= 82) return 'warning'
  return 'stable'
}

function formatQueueEntry(letter) {
  return `${letter}:`
}

function createDefaultScanProgress() {
  return {
    phase: 'idle',
    percent: 0,
    rootsCompleted: 0,
    rootsTotal: 0,
    filesVisited: 0,
    directoriesVisited: 0,
    bytesSeen: 0,
    currentRoot: null,
    currentPath: null,
    elapsedMs: 0,
    updatedAt: null,
  }
}

function createDefaultAnalysis(letter) {
  return {
    letter,
    scanStatus: 'queued',
    aiStatus: aiEnabled() ? 'idle' : 'idle',
    lastScannedAt: null,
    lastAiAnalyzedAt: null,
    scanDurationMs: null,
    aiDurationMs: null,
    scanError: null,
    aiError: null,
    scanProgress: createDefaultScanProgress(),
    topEntries: [],
    focusDirectories: [],
    notableFiles: [],
    opportunities: [],
    fallbackOpportunities: [],
    analysisSource: 'heuristic',
    analysisSummary: '',
    aiGuidance: [],
  }
}

function ensureAnalysis(letter) {
  if (!state.analyses.has(letter)) {
    state.analyses.set(letter, createDefaultAnalysis(letter))
  }
  return state.analyses.get(letter)
}

function applyAnalysisToDrive(baseDrive, analysis) {
  return {
    ...baseDrive,
    scanStatus: analysis.scanStatus,
    aiStatus: analysis.aiStatus,
    lastScannedAt: analysis.lastScannedAt,
    lastAiAnalyzedAt: analysis.lastAiAnalyzedAt,
    scanDurationMs: analysis.scanDurationMs,
    aiDurationMs: analysis.aiDurationMs,
    scanError: analysis.scanError,
    aiError: analysis.aiError,
    scanProgress: analysis.scanProgress,
    topEntries: analysis.topEntries,
    focusDirectories: analysis.focusDirectories,
    notableFiles: analysis.notableFiles,
    opportunities: analysis.opportunities,
    analysisSource: analysis.analysisSource,
    analysisSummary: analysis.analysisSummary,
    aiGuidance: analysis.aiGuidance,
  }
}

function syncDriveState(letter) {
  const analysis = ensureAnalysis(letter)
  const index = state.drives.findIndex((drive) => drive.letter === letter)
  if (index === -1) return
  state.drives[index] = applyAnalysisToDrive(state.drives[index], analysis)
  state.generatedAt = new Date().toISOString()
}

function syncSystemState(partial = {}) {
  const config = aiRuntime()
  const clientSettings = localStore.getClientSettings()
  state.system = {
    ...state.system,
    queueDepth: state.scanQueue.length,
    scanQueueDepth: state.scanQueue.length,
    aiQueueDepth: state.aiQueue.length,
    activeScan: activeScanChild?.letter ?? null,
    activeAi: activeAiTask?.label ?? null,
    analysisEngine: config.enabled
      ? 'provider+rules'
      : clientSettings.cachedAt && clientSettings.runtime.allowOfflineCache
        ? 'offline-cache+rules'
        : 'rules-only',
    aiEnabled: config.enabled,
    aiProvider: config.provider,
    aiModel: config.enabled ? config.model : null,
    selectedProvider: runtimeSettings().providerId,
    language: runtimeSettings().language,
    reportStyle: runtimeSettings().reportStyle,
    setupRequired: clientSettings.setupRequired,
    ...partial,
  }
}

function enqueueScan(letter, position = 'tail') {
  const normalized = String(letter ?? '').trim().toUpperCase()
  if (!/^[A-Z]$/.test(normalized)) return
  if (state.scanQueue.includes(normalized)) return
  if (activeScanChild?.letter === normalized) return

  if (position === 'head') {
    state.scanQueue.unshift(normalized)
  } else {
    state.scanQueue.push(normalized)
  }

  const analysis = ensureAnalysis(normalized)
  analysis.scanStatus = 'queued'
  analysis.scanError = null
  syncDriveState(normalized)
  syncSystemState()
}

function enqueueAiTask(task) {
  if (!aiEnabled()) return
  const key = task.kind === 'drive' ? `drive:${task.letter}` : 'cross'
  const existsInQueue = state.aiQueue.some((item) => item.key === key)
  const isActive = activeAiTask?.key === key
  if (existsInQueue || isActive) return

  state.aiQueue.push({ ...task, key })
  if (task.kind === 'drive') {
    const analysis = ensureAnalysis(task.letter)
    if (analysis.aiStatus === 'idle' || analysis.aiStatus === 'error') {
      analysis.aiStatus = 'queued'
      analysis.aiError = null
      syncDriveState(task.letter)
    }
  }

  syncSystemState()
}

function scheduleCrossDriveAi() {
  if (!aiEnabled()) return
  if (crossDriveTimer) clearTimeout(crossDriveTimer)
  crossDriveTimer = setTimeout(() => {
    enqueueAiTask({ kind: 'cross', label: 'cross-drive' })
  }, CROSS_DRIVE_AI_DEBOUNCE_MS)
}

function mergeOpportunities(primary, fallback) {
  const merged = []
  const seen = new Set()
  for (const item of [...primary, ...fallback]) {
    if (!item) continue
    const key = `${item.path}|${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged.sort((a, b) => b.estimatedBytes - a.estimatedBytes).slice(0, 12)
}

function deriveCrossDrive(drives) {
  const nameMap = new Map()

  for (const drive of drives) {
    for (const entry of drive.topEntries ?? []) {
      const key = entry.name.toLowerCase()
      if (!nameMap.has(key)) nameMap.set(key, [])
      nameMap.get(key).push({
        drive: drive.letter,
        sizeBytes: entry.sizeBytes,
        path: entry.path,
      })
    }
  }

  const duplicateTopLevelNames = [...nameMap.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([name, items]) => ({
      name,
      drives: items.map((item) => item.drive),
      combinedBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
      paths: items.map((item) => item.path),
    }))
    .sort((a, b) => b.combinedBytes - a.combinedBytes)
    .slice(0, 12)

  const topOpportunities = drives
    .flatMap((drive) => drive.opportunities ?? [])
    .sort((a, b) => b.estimatedBytes - a.estimatedBytes)
    .slice(0, 14)

  const language = currentLanguage()
  const style = currentReportStyle()
  const fallbackSuggestions = fallbackStandardizationSuggestions(language)
  const cachedCrossDrive =
    localStore.getSettings().runtime.allowOfflineCache ? localStore.getCrossDriveCache() : null

  return {
    duplicateTopLevelNames,
    topOpportunities,
    standardizationSuggestions:
      state.crossDriveAi.standardizationSuggestions.length > 0
        ? state.crossDriveAi.standardizationSuggestions
        : cachedCrossDrive?.standardizationSuggestions?.length
          ? cachedCrossDrive.standardizationSuggestions
          : fallbackSuggestions,
    summary:
      state.crossDriveAi.summary ||
      cachedCrossDrive?.summary ||
      buildFallbackCrossSummary(duplicateTopLevelNames, topOpportunities, language, style),
    fallbackSuggestions,
  }
}

async function refreshLiveSystem() {
  const [fsSize, mem, currentLoad] = await Promise.all([
    si.fsSize(),
    si.mem(),
    si.currentLoad(),
  ])

  const drives = fsSize
    .filter((item) => /^[A-Z]:/i.test(item.mount || item.fs))
    .map((item) => {
      const mount = item.mount || item.fs
      const letter = mount[0].toUpperCase()
      const analysis = ensureAnalysis(letter)
      const totalBytes = bytes(item.size)
      const usedBytes = bytes(item.used)
      const freeBytes = Math.max(totalBytes - usedBytes, 0)
      const usePercent = totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100

      return applyAnalysisToDrive(
        {
          letter,
          mount,
          fsType: item.type || item.fsType || 'unknown',
          totalBytes,
          usedBytes,
          freeBytes,
          usePercent,
          health: classifyDriveHealth(usePercent),
        },
        analysis,
      )
    })
    .sort((a, b) => a.letter.localeCompare(b.letter))

  for (const drive of drives) {
    const stale =
      !drive.lastScannedAt ||
      Date.now() - new Date(drive.lastScannedAt).getTime() > ANALYSIS_STALE_MS
    if (stale && drive.scanStatus !== 'scanning') {
      enqueueScan(drive.letter)
    }
  }

  const totalBytes = drives.reduce((sum, drive) => sum + drive.totalBytes, 0)
  const usedBytes = drives.reduce((sum, drive) => sum + drive.usedBytes, 0)
  const freeBytes = drives.reduce((sum, drive) => sum + drive.freeBytes, 0)
  const crossDrive = deriveCrossDrive(drives)
  const config = aiRuntime()

  state.generatedAt = new Date().toISOString()
  state.drives = drives
  syncSystemState({
    hostName: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuLoadPercent: currentLoad.currentLoad,
    memoryUsedPercent: mem.total === 0 ? 0 : (mem.used / mem.total) * 100,
    totalBytes,
    usedBytes,
    freeBytes,
    driveCount: drives.length,
    historySamples: Math.min(MAX_HISTORY_POINTS, state.system.historySamples + 1),
    uptimeMinutes: Math.floor((Date.now() - state.bootedAt) / 60000),
    aiProvider: config.provider,
    aiModel: config.enabled ? config.model : null,
  })

  state.crossDrive = {
    duplicateTopLevelNames: crossDrive.duplicateTopLevelNames,
    standardizationSuggestions: crossDrive.standardizationSuggestions,
    topOpportunities: crossDrive.topOpportunities,
    summary: crossDrive.summary,
  }
}

function parseJsonLine(rawLine, prefix) {
  const cleaned = rawLine.replace(/^\uFEFF/, '')
  if (!cleaned.startsWith(prefix)) return null
  return JSON.parse(cleaned.slice(prefix.length))
}

function runScanner(letter) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scanScript, '-DriveLetter', letter],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    activeScanChild = { letter, child }
    syncSystemState()

    const analysis = ensureAnalysis(letter)
    analysis.scanStatus = 'scanning'
    analysis.scanError = null
    analysis.scanDurationMs = null
    analysis.scanProgress = {
      ...createDefaultScanProgress(),
      phase: 'preparing',
      updatedAt: new Date().toISOString(),
    }
    syncDriveState(letter)

    let resultPayload = null
    let stderr = ''

    const stdoutReader = createInterface({ input: child.stdout })
    stdoutReader.on('line', (line) => {
      const progress = parseJsonLine(line, '__PROGRESS__')
      if (progress) {
        const normalizedProgress = readProgress(progress)
        analysis.scanProgress = {
          phase: normalizedProgress.phase,
          percent: normalizedProgress.percent,
          rootsCompleted: normalizedProgress.rootsCompleted,
          rootsTotal: normalizedProgress.rootsTotal,
          filesVisited: normalizedProgress.filesVisited,
          directoriesVisited: normalizedProgress.directoriesVisited,
          bytesSeen: normalizedProgress.bytesSeen,
          currentRoot: normalizedProgress.currentRoot,
          currentPath: normalizedProgress.currentPath,
          elapsedMs: normalizedProgress.elapsedMs,
          updatedAt: new Date().toISOString(),
        }
        syncDriveState(letter)
        return
      }

      const result = parseJsonLine(line, '__RESULT__')
      if (result) resultPayload = result
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      activeScanChild = null
      syncSystemState()
      reject(error)
    })

    child.on('close', (code) => {
      activeScanChild = null
      syncSystemState()
      if (code !== 0) {
        reject(new Error(stderr.trim() || `scanner exited with code ${code}`))
        return
      }
      if (!resultPayload) {
        reject(new Error('scanner returned no result payload'))
        return
      }
      resolve(resultPayload)
    })
  })
}

function applyCachedDriveResult(letter) {
  if (!localStore.getSettings().runtime.allowOfflineCache) return false
  const cached = localStore.getDriveCache(letter)
  if (!cached) return false

  const analysis = ensureAnalysis(letter)
  analysis.opportunities = mergeOpportunities(
    cached.opportunities ?? [],
    analysis.fallbackOpportunities ?? [],
  )
  analysis.analysisSummary = cached.summary || analysis.analysisSummary
  analysis.aiGuidance = cached.guidance?.length ? cached.guidance : analysis.aiGuidance
  analysis.analysisSource = 'offline-cache'
  analysis.aiStatus = 'ready'
  analysis.lastAiAnalyzedAt = cached.updatedAt ?? analysis.lastAiAnalyzedAt
  analysis.aiError =
    currentLanguage() === 'en-US'
      ? 'Using the most recent online cached analysis.'
      : '当前使用最近一次联网缓存分析。'
  analysis.aiDurationMs = null
  syncDriveState(letter)
  return true
}

async function finalizeScan(letter, raw) {
  const topEntries = toArray(readField(raw, 'topEntries', 'TopEntries')).map(readEntry)
  const focusDirectories = toArray(readField(raw, 'focusDirectories', 'FocusDirectories')).map(readFocusDirectory)
  const notableFiles = toArray(readField(raw, 'notableFiles', 'NotableFiles')).map(readEntry)
  const stats = readStats(readField(raw, 'stats', 'Stats'))

  const language = currentLanguage()
  const style = currentReportStyle()
  const fallbackOpportunities = buildFallbackOpportunities(
    letter,
    [...topEntries, ...focusDirectories.flatMap((group) => group.children ?? []), ...notableFiles],
    language,
  ).sort((a, b) => b.estimatedBytes - a.estimatedBytes)

  const drive = state.drives.find((item) => item.letter === letter) ?? {
    letter,
    usePercent: 0,
    freeBytes: 0,
    totalBytes: 0,
    usedBytes: 0,
    fsType: 'unknown',
  }

  const analysis = ensureAnalysis(letter)
  analysis.scanStatus = 'ready'
  analysis.lastScannedAt = new Date().toISOString()
  analysis.scanDurationMs = stats.elapsedMs
  analysis.scanError = null
  analysis.scanProgress = {
    phase: 'complete',
    percent: 100,
    rootsCompleted: stats.rootsCompleted,
    rootsTotal: stats.rootsTotal,
    filesVisited: stats.filesVisited,
    directoriesVisited: stats.directoriesVisited,
    bytesSeen: stats.bytesSeen,
    currentRoot: null,
    currentPath: null,
    elapsedMs: stats.elapsedMs,
    updatedAt: new Date().toISOString(),
  }
  analysis.topEntries = topEntries
  analysis.focusDirectories = focusDirectories
  analysis.notableFiles = notableFiles
  analysis.fallbackOpportunities = fallbackOpportunities
  analysis.opportunities = fallbackOpportunities
  analysis.analysisSource = 'heuristic'
  analysis.analysisSummary = buildFallbackDriveSummary(
    drive,
    topEntries,
    fallbackOpportunities,
    language,
    style,
  )
  analysis.aiGuidance = buildFallbackDriveGuidance(drive, fallbackOpportunities, language)
  analysis.aiStatus = aiEnabled() ? 'queued' : 'idle'
  analysis.aiError = null
  analysis.aiDurationMs = null

  if (!aiEnabled()) {
    applyCachedDriveResult(letter)
  }

  syncDriveState(letter)
  enqueueAiTask({ kind: 'drive', letter, label: `${letter}:analysis` })
  scheduleCrossDriveAi()
}

async function processScanQueue() {
  if (activeScanChild || state.scanQueue.length === 0) return
  const letter = state.scanQueue.shift()
  if (!letter) return
  syncSystemState()

  try {
    const raw = await runScanner(letter)
    await finalizeScan(letter, raw)
    await refreshLiveSystem()
  } catch (error) {
    const analysis = ensureAnalysis(letter)
    analysis.scanStatus = 'error'
    analysis.scanError = error instanceof Error ? error.message : 'scan failed'
    analysis.scanProgress = {
      ...analysis.scanProgress,
      phase: 'error',
      updatedAt: new Date().toISOString(),
    }
    syncDriveState(letter)
  } finally {
    syncSystemState()
  }
}

async function runDriveAiTask(letter) {
  const analysis = ensureAnalysis(letter)
  if (analysis.scanStatus !== 'ready') return

  const drive = state.drives.find((item) => item.letter === letter)
  if (!drive) return

  analysis.aiStatus = 'analyzing'
  analysis.aiError = null
  syncDriveState(letter)

  const startedAt = Date.now()
  const result = await analyzeDriveWithAi(
    {
      drive: {
        letter,
        fsType: drive.fsType,
        totalBytes: drive.totalBytes,
        usedBytes: drive.usedBytes,
        freeBytes: drive.freeBytes,
        usePercent: drive.usePercent,
      },
      topEntries: analysis.topEntries.slice(0, 8),
      focusDirectories: analysis.focusDirectories.slice(0, 4).map((group) => ({
        ...group,
        children: group.children.slice(0, 6),
      })),
      notableFiles: analysis.notableFiles.slice(0, 8),
      fallbackOpportunities: analysis.fallbackOpportunities.slice(0, 6),
    },
    runtimeSettings(),
  )

  if (!result) return

  analysis.opportunities = mergeOpportunities(result.opportunities ?? [], analysis.fallbackOpportunities)
  analysis.analysisSummary = result.summary || analysis.analysisSummary
  analysis.aiGuidance = result.guidance?.length > 0 ? result.guidance : analysis.aiGuidance
  analysis.analysisSource = 'ai+heuristic'
  analysis.aiStatus = 'ready'
  analysis.aiDurationMs = Date.now() - startedAt
  analysis.lastAiAnalyzedAt = new Date().toISOString()
  analysis.aiError = null
  syncDriveState(letter)

  if (localStore.getSettings().runtime.autoSaveOnlineCache) {
    localStore.updateDriveCache(letter, {
      updatedAt: analysis.lastAiAnalyzedAt,
      summary: analysis.analysisSummary,
      opportunities: analysis.opportunities,
      guidance: analysis.aiGuidance,
    })
  }

  scheduleCrossDriveAi()
}

async function runCrossDriveAiTask() {
  const readyDrives = state.drives
    .filter((drive) => drive.scanStatus === 'ready')
    .map((drive) => ({
      letter: drive.letter,
      fsType: drive.fsType,
      usePercent: drive.usePercent,
      freeBytes: drive.freeBytes,
      topEntries: drive.topEntries.slice(0, 6),
      opportunities: drive.opportunities.slice(0, 4),
      analysisSummary: drive.analysisSummary ?? '',
    }))

  if (readyDrives.length === 0) return

  const fallback = deriveCrossDrive(state.drives)
  const result = await analyzeCrossDriveWithAi(
    {
      drives: readyDrives,
      duplicateTopLevelNames: fallback.duplicateTopLevelNames,
      topOpportunities: fallback.topOpportunities,
      fallbackSuggestions: fallback.fallbackSuggestions,
    },
    runtimeSettings(),
  )

  if (!result) return

  state.crossDriveAi = {
    summary: result.summary ?? '',
    standardizationSuggestions: result.standardizationSuggestions ?? [],
    updatedAt: new Date().toISOString(),
  }
  state.system.aiLastAnalyzedAt = state.crossDriveAi.updatedAt

  if (localStore.getSettings().runtime.autoSaveOnlineCache) {
    localStore.updateCrossDriveCache({
      updatedAt: state.crossDriveAi.updatedAt,
      summary: state.crossDriveAi.summary,
      standardizationSuggestions: state.crossDriveAi.standardizationSuggestions,
    })
  }

  await refreshLiveSystem()
}

async function processAiQueue() {
  if (activeAiTask || state.aiQueue.length === 0 || !aiEnabled()) return
  const task = state.aiQueue.shift()
  if (!task) return

  activeAiTask = task
  syncSystemState({ aiStatus: 'running', aiLastError: null })

  try {
    if (task.kind === 'drive') {
      await runDriveAiTask(task.letter)
    } else if (task.kind === 'cross') {
      await runCrossDriveAiTask()
    }

    syncSystemState({
      aiStatus: state.aiQueue.length > 0 ? 'queued' : 'ready',
      aiLastError: null,
      aiLastAnalyzedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI task failed'

    if (task.kind === 'drive') {
      const analysis = ensureAnalysis(task.letter)
      const restored = applyCachedDriveResult(task.letter)
      if (!restored) {
        analysis.aiStatus = 'error'
        analysis.aiError = message
      }
      syncDriveState(task.letter)
    }

    syncSystemState({
      aiStatus: localStore.getSettings().runtime.allowOfflineCache ? 'degraded-cache' : 'degraded',
      aiLastError: message,
    })
  } finally {
    activeAiTask = null
    syncSystemState()
  }
}

function snapshotPayload() {
  return {
    generatedAt: state.generatedAt,
    system: state.system,
    drives: state.drives,
    crossDrive: state.crossDrive,
    settings: localStore.getClientSettings(),
  }
}

function scheduleAiRefreshAfterSettings() {
  if (!aiEnabled()) return
  for (const drive of state.drives) {
    const analysis = ensureAnalysis(drive.letter)
    if (analysis.scanStatus === 'ready' && analysis.aiStatus !== 'analyzing') {
      enqueueAiTask({ kind: 'drive', letter: drive.letter, label: `${drive.letter}:analysis` })
    }
  }
  scheduleCrossDriveAi()
}

app.get('/api/snapshot', (_req, res) => {
  res.json(snapshotPayload())
})

app.get('/api/providers', (_req, res) => {
  res.json({ providers: localStore.getProviderCatalog() })
})

app.get('/api/settings', (_req, res) => {
  res.json(localStore.getClientSettings())
})

app.post('/api/settings', async (req, res) => {
  const settings = localStore.updateSettings(req.body ?? {})
  syncSystemState({
    aiStatus: aiEnabled() ? 'idle' : 'disabled',
    aiLastError: null,
  })
  scheduleAiRefreshAfterSettings()
  await refreshLiveSystem()
  res.json({ ok: true, settings })
})

app.post('/api/rescan', async (req, res) => {
  const requested = String(req.body?.drive ?? '').trim().toUpperCase()
  if (!requested || !/^[A-Z]$/.test(requested)) {
    res.status(400).json({
      ok: false,
      message:
        currentLanguage() === 'en-US'
          ? 'A valid drive letter is required.'
          : '需要提供有效的盘符字母。',
    })
    return
  }

  const analysis = ensureAnalysis(requested)
  analysis.scanStatus = 'queued'
  analysis.aiStatus = 'idle'
  analysis.scanError = null
  analysis.aiError = null
  analysis.scanProgress = createDefaultScanProgress()
  analysis.analysisSummary = ''
  analysis.aiGuidance = []
  enqueueScan(requested, 'head')
  await refreshLiveSystem()
  res.json({ ok: true, queued: formatQueueEntry(requested) })
})

app.post('/api/chat', async (req, res) => {
  const driveLetter = String(req.body?.drive ?? '').trim().toUpperCase()
  const message = String(req.body?.message ?? '').trim()
  const history = Array.isArray(req.body?.history)
    ? req.body.history
        .map((item) => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          content: String(item?.content ?? '').trim(),
        }))
        .filter((item) => item.content)
        .slice(-8)
    : []

  if (!driveLetter || !/^[A-Z]$/.test(driveLetter)) {
    res.status(400).json({
      ok: false,
      message:
        currentLanguage() === 'en-US'
          ? 'A valid drive letter is required.'
          : '需要提供有效的盘符字母。',
    })
    return
  }

  if (!message) {
    res.status(400).json({
      ok: false,
      message: currentLanguage() === 'en-US' ? 'Please enter a question.' : '请输入问题内容。',
    })
    return
  }

  if (!aiEnabled()) {
    res.status(400).json({
      ok: false,
      message:
        currentLanguage() === 'en-US'
          ? 'AI provider is not configured yet.'
          : '当前还没有配置可用的 AI 供应商。',
    })
    return
  }

  const drive = state.drives.find((item) => item.letter === driveLetter)
  const analysis = ensureAnalysis(driveLetter)
  if (!drive || analysis.scanStatus !== 'ready') {
    res.status(400).json({
      ok: false,
      message:
        currentLanguage() === 'en-US'
          ? 'The selected drive has not completed scanning yet.'
          : '所选磁盘尚未完成扫描。',
    })
    return
  }

  try {
    const reply = await chatWithDriveContext(
      {
        drive: {
          letter: driveLetter,
          fsType: drive.fsType,
          usePercent: drive.usePercent,
          freeBytes: drive.freeBytes,
          totalBytes: drive.totalBytes,
        },
        summary: analysis.analysisSummary,
        opportunities: analysis.opportunities.slice(0, 8),
        topEntries: analysis.topEntries.slice(0, 8),
        focusDirectories: analysis.focusDirectories.slice(0, 4),
        notableFiles: analysis.notableFiles.slice(0, 8),
        aiGuidance: analysis.aiGuidance.slice(0, 4),
        crossDriveSummary: state.crossDrive.summary,
        history,
        message,
      },
      runtimeSettings(),
    )

    res.json({ ok: true, reply })
  } catch (error) {
    res.status(500).json({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : currentLanguage() === 'en-US'
            ? 'AI chat failed.'
            : 'AI 对话失败。',
    })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    generatedAt: state.generatedAt,
    activeScan: state.system.activeScan,
    activeAi: state.system.activeAi,
    scanQueueDepth: state.system.scanQueueDepth,
    aiQueueDepth: state.system.aiQueueDepth,
    analysisEngine: state.system.analysisEngine,
    aiEnabled: state.system.aiEnabled,
    aiStatus: state.system.aiStatus,
    aiModel: state.system.aiModel,
    selectedProvider: state.system.selectedProvider,
    setupRequired: state.system.setupRequired,
  })
})

app.use(express.static(distRoot))

app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(distRoot, 'index.html'), (error) => {
    if (error) next()
  })
})

async function boot() {
  await refreshLiveSystem()
  processScanQueue().catch(() => {})
  processAiQueue().catch(() => {})

  setInterval(() => {
    refreshLiveSystem().catch(() => {})
  }, LIVE_REFRESH_MS)

  setInterval(() => {
    processScanQueue().catch(() => {})
  }, 250)

  setInterval(() => {
    processAiQueue().catch(() => {})
  }, 250)

  app.listen(PORT, () => {
    console.log(`Aegis Disk Command started: http://127.0.0.1:${PORT}`)
  })
}

boot().catch((error) => {
  console.error('Aegis Disk Command failed to start:', error)
  process.exitCode = 1
})
