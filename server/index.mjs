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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distRoot = path.join(projectRoot, 'dist')
const scanScript = path.join(__dirname, 'scan-drive.ps1')
const app = express()

const PORT = Number(process.env.PORT ?? 5525)
const LIVE_REFRESH_MS = 1500
const ANALYSIS_STALE_MS = 1000 * 60 * 8
const MAX_HISTORY_POINTS = 120
const CROSS_DRIVE_AI_DEBOUNCE_MS = 2000
const aiConfig = getAiRuntimeConfig()

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
    analysisEngine: aiConfig.enabled ? 'DeepSeek + 规则兜底' : '规则启发式',
    aiEnabled: aiConfig.enabled,
    aiProvider: aiConfig.provider,
    aiModel: aiConfig.enabled ? aiConfig.model : null,
    aiStatus: aiConfig.enabled ? '待机' : '未启用',
    aiLastError: null,
    aiLastAnalyzedAt: null,
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

app.use(express.json({ limit: '1mb' }))

function bytes(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function classifyDriveHealth(usePercent) {
  if (usePercent >= 92) return 'critical'
  if (usePercent >= 82) return 'warning'
  return 'stable'
}

function formatQueueEntry(letter) {
  return `${letter}:`
}

function rankSeverity(weight) {
  if (weight >= 2.5) return 'critical'
  if (weight >= 1.5) return 'warning'
  return 'info'
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function inspectName(rawName) {
  const name = String(rawName ?? '').toLowerCase()

  if (includesAny(name, ['$recycle', '回收', 'recycle'])) {
    return {
      category: 'reclaim',
      title: '回收区可直接释放空间',
      action: '确认没有需要恢复的文件后，优先清空回收站通常是风险最低、收益最快的一步。',
      weight: 2.7,
    }
  }

  if (
    includesAny(name, [
      'cache',
      'temp',
      'deliveryoptimization',
      'logs',
      '缓存',
      '临时',
      '日志',
      'tmp',
    ])
  ) {
    return {
      category: 'cache',
      title: '检测到高占用缓存或临时区',
      action: '建议先确认是否属于缓存、日志或临时文件，能安全清理的内容优先释放。',
      weight: 1.9,
    }
  }

  if (
    includesAny(name, [
      'download',
      'softstore',
      'installer',
      'archive',
      'setup',
      '下载',
      '安装包',
      '压缩包',
      '归档',
    ])
  ) {
    return {
      category: 'download',
      title: '下载仓或安装包堆积',
      action: '去重后只保留仍在使用的安装包与镜像，其余内容适合归档或转移。',
      weight: 1.8,
    }
  }

  if (
    includesAny(name, [
      'video',
      'jiany',
      'bililive',
      'draft',
      'clip',
      'record',
      '视频',
      '录屏',
      '剪映',
      '素材',
    ])
  ) {
    return {
      category: 'media',
      title: '媒体生产目录占用较高',
      action: '建议把已完成的素材、录屏和中间产物转入冷存储，本地只保留当前工作集。',
      weight: 1.6,
    }
  }

  if (
    includesAny(name, [
      'docker',
      'wsl',
      'vhd',
      'vmdk',
      'emulator',
      'hyperv',
      'virtual',
      '虚拟机',
      '镜像',
    ])
  ) {
    return {
      category: 'virtualization',
      title: '虚拟磁盘或模拟器负载较重',
      action: '先确认镜像是否仍在使用，再决定是精简、归档还是迁移，避免误删运行环境。',
      weight: 1.5,
    }
  }

  if (
    includesAny(name, [
      'huawei',
      'deveco',
      'openharmony',
      'sdk',
      'android',
      'toolchain',
      '开发',
      '工具链',
    ])
  ) {
    return {
      category: 'toolchain',
      title: '工具链或 SDK 区域偏重',
      action: '建议把 DevEco、Huawei SDK、OpenHarmony 和模拟器资源收拢到统一工具根目录。',
      weight: 1.4,
    }
  }

  if (
    includesAny(name, [
      'onedrive',
      'desktop',
      'documents',
      'sync',
      '文档',
      '桌面',
      '同步',
    ])
  ) {
    return {
      category: 'sync',
      title: '同步目录承载了较大内容',
      action: '尽量把大体积临时文件、安装包和素材移出同步区，避免云同步长期承压。',
      weight: 1.4,
    }
  }

  if (includesAny(name, ['steam', 'wegame', 'mihoyo', 'game', '游戏'])) {
    return {
      category: 'games',
      title: '游戏库占用明显',
      action: '建议按平台统一管理游戏库，避免同一游戏多平台重复安装。',
      weight: 1.2,
    }
  }

  return null
}

function buildFallbackOpportunities(letter, entries) {
  return entries
    .map((entry) => {
      const hit = inspectName(entry.path)
      if (!hit) return null

      return {
        id: `${letter}-${entry.path}`,
        drive: letter,
        path: entry.path,
        category: hit.category,
        severity: rankSeverity(hit.weight + entry.sizeBytes / 150_000_000_000),
        title: hit.title,
        action: hit.action,
        estimatedBytes: entry.sizeBytes,
      }
    })
    .filter(Boolean)
}

function fallbackStandardizationSuggestions() {
  return [
    {
      title: '统一下载仓入口',
      detail:
        '安装包、网盘落地文件、软件商店下载物和临时 setup 建议汇总到一个受控归档根目录，避免多盘散落。',
    },
    {
      title: '同步区和临时区分层',
      detail:
        'OneDrive、桌面、文档等同步面只保留明确需要同步的内容，大型素材、录屏和安装包不要长期停留在同步目录。',
    },
    {
      title: '收拢重复工具链',
      detail:
        'DevEco、Huawei SDK、OpenHarmony 资源和模拟器镜像建议放入统一工具根目录，活动版本与历史归档分层管理。',
    },
    {
      title: '按平台规范游戏库',
      detail:
        '同一游戏尽量只保留一个平台库，减少独立版、Steam、WeGame 并行安装造成的重复占用。',
    },
  ]
}

function buildFallbackDriveGuidance(drive, opportunities) {
  const items = []

  if (drive.usePercent >= 92) {
    items.push({
      title: '可用余量已经接近极限',
      detail: '当前盘的安全缓冲很薄，优先从回收站、下载仓、安装包和重复安装面拿回空间。',
      tone: 'critical',
    })
  } else if (drive.usePercent >= 82) {
    items.push({
      title: '已经进入容量预警区间',
      detail: '在下一次大型安装、同步爆发或素材导入之前，最好先完成一轮针对性的清理。',
      tone: 'warning',
    })
  } else {
    items.push({
      title: '当前盘面余量相对稳定',
      detail: '这个盘还有一定缓冲，适合进一步明确职责边界，减少后续目录混杂。',
      tone: 'stable',
    })
  }

  if (opportunities.length > 0) {
    items.push({
      title: '已识别出高收益整理线索',
      detail: '当前扫描结果里已经出现缓存区、下载仓、媒体目录或工具链重复面，适合优先处理。',
      tone: 'warning',
    })
  }

  items.push({
    title: '建议保持盘面职责单一',
    detail:
      '尽量让一个盘只承担一类核心任务，例如系统、开发、游戏、媒体或归档，这样扫描、迁移和清理都会更稳定。',
    tone: 'info',
  })

  return items
}

function buildFallbackDriveSummary(drive, topEntries, opportunities) {
  const heaviest = topEntries.slice(0, 3).map((entry) => entry.name).join('、')
  const lead =
    drive.usePercent >= 90
      ? '当前盘容量压力很高。'
      : drive.usePercent >= 80
        ? '当前盘已经进入预警区。'
        : '当前盘容量状态相对平稳。'

  const focus = heaviest ? `最重的顶层区域主要是 ${heaviest}。` : '目前还没有完成足够的目录样本。'
  const action =
    opportunities.length > 0
      ? `已发现 ${opportunities.length} 条值得优先检查的整理线索。`
      : '暂未发现明显的高收益机会位。'

  return `${lead}${focus}${action}`
}

function buildFallbackCrossSummary(duplicates, topOpportunities) {
  if (duplicates.length === 0 && topOpportunities.length === 0) {
    return '目前还没有形成明显的跨盘重复面或高优先级整理信号。'
  }

  if (duplicates.length > 0) {
    return `已发现 ${duplicates.length} 组跨盘重名顶层目录，建议优先收拢职责重复的目录。`
  }

  return `全局已识别出 ${topOpportunities.length} 条高收益整理机会，建议按容量收益从高到低处理。`
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
    aiStatus: aiConfig.enabled ? 'idle' : 'idle',
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
  state.system = {
    ...state.system,
    queueDepth: state.scanQueue.length,
    scanQueueDepth: state.scanQueue.length,
    aiQueueDepth: state.aiQueue.length,
    activeScan: activeScanChild?.letter ?? null,
    activeAi: activeAiTask?.label ?? null,
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
  if (!aiConfig.enabled) return

  const key = task.kind === 'drive' ? `drive:${task.letter}` : 'cross'
  const existsInQueue = state.aiQueue.some((item) => item.key === key)
  const isActive = activeAiTask?.key === key
  if (existsInQueue || isActive) return

  const queuedTask = { ...task, key }
  state.aiQueue.push(queuedTask)

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
  if (!aiConfig.enabled) return
  if (crossDriveTimer) {
    clearTimeout(crossDriveTimer)
  }

  crossDriveTimer = setTimeout(() => {
    enqueueAiTask({ kind: 'cross', label: '跨盘分析' })
  }, CROSS_DRIVE_AI_DEBOUNCE_MS)
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

  const fallbackSuggestions = fallbackStandardizationSuggestions()

  return {
    duplicateTopLevelNames,
    topOpportunities,
    standardizationSuggestions:
      state.crossDriveAi.standardizationSuggestions.length > 0
        ? state.crossDriveAi.standardizationSuggestions
        : fallbackSuggestions,
    summary:
      state.crossDriveAi.summary || buildFallbackCrossSummary(duplicateTopLevelNames, topOpportunities),
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
          fsType: item.type || item.fsType || '未知',
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
    analysisEngine: aiConfig.enabled ? 'DeepSeek + 规则兜底' : '规则启发式',
    aiEnabled: aiConfig.enabled,
    aiProvider: aiConfig.provider,
    aiModel: aiConfig.enabled ? aiConfig.model : null,
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
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scanScript,
      '-DriveLetter',
      letter,
    ]

    const child = spawn('powershell', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

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

    const handleProgress = (payload) => {
      analysis.scanProgress = {
        phase: payload.phase,
        percent: payload.percent,
        rootsCompleted: payload.rootsCompleted,
        rootsTotal: payload.rootsTotal,
        filesVisited: payload.filesVisited,
        directoriesVisited: payload.directoriesVisited,
        bytesSeen: payload.bytesSeen,
        currentRoot: payload.currentRoot,
        currentPath: payload.currentPath,
        elapsedMs: payload.elapsedMs,
        updatedAt: new Date().toISOString(),
      }
      syncDriveState(letter)
    }

    const stdoutReader = createInterface({ input: child.stdout })
    stdoutReader.on('line', (line) => {
      const progress = parseJsonLine(line, '__PROGRESS__')
      if (progress) {
        handleProgress(progress)
        return
      }

      const result = parseJsonLine(line, '__RESULT__')
      if (result) {
        resultPayload = result
      }
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
        reject(new Error(stderr.trim() || `扫描进程异常退出，代码 ${code}`))
        return
      }

      if (!resultPayload) {
        reject(new Error('扫描进程没有返回结果。'))
        return
      }

      resolve(resultPayload)
    })
  })
}

async function finalizeScan(letter, raw) {
  const topEntries = toArray(raw.topEntries).map((entry) => ({
    name: entry.name,
    path: entry.path,
    type: entry.type,
    extension: entry.extension ?? null,
    sizeBytes: bytes(entry.sizeBytes),
  }))

  const focusDirectories = toArray(raw.focusDirectories).map((group) => ({
    name: group.name,
    path: group.path,
    sizeBytes: bytes(group.sizeBytes),
    children: toArray(group.children).map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      extension: entry.extension ?? null,
      sizeBytes: bytes(entry.sizeBytes),
    })),
  }))

  const notableFiles = toArray(raw.notableFiles).map((entry) => ({
    name: entry.name,
    path: entry.path,
    type: entry.type,
    extension: entry.extension ?? null,
    sizeBytes: bytes(entry.sizeBytes),
  }))

  const fallbackOpportunities = buildFallbackOpportunities(letter, [
    ...topEntries,
    ...focusDirectories.flatMap((group) => group.children ?? []),
    ...notableFiles,
  ]).sort((a, b) => b.estimatedBytes - a.estimatedBytes)

  const drive = state.drives.find((item) => item.letter === letter) ?? {
    letter,
    usePercent: 0,
    freeBytes: 0,
    totalBytes: 0,
    usedBytes: 0,
    fsType: '未知',
  }

  const analysis = ensureAnalysis(letter)
  analysis.scanStatus = 'ready'
  analysis.lastScannedAt = new Date().toISOString()
  analysis.scanDurationMs = bytes(raw.stats?.elapsedMs)
  analysis.scanError = null
  analysis.scanProgress = {
    phase: 'complete',
    percent: 100,
    rootsCompleted: Number(raw.stats?.rootsCompleted ?? 0),
    rootsTotal: Number(raw.stats?.rootsTotal ?? 0),
    filesVisited: bytes(raw.stats?.filesVisited),
    directoriesVisited: bytes(raw.stats?.directoriesVisited),
    bytesSeen: bytes(raw.stats?.bytesSeen),
    currentRoot: null,
    currentPath: null,
    elapsedMs: bytes(raw.stats?.elapsedMs),
    updatedAt: new Date().toISOString(),
  }
  analysis.topEntries = topEntries
  analysis.focusDirectories = focusDirectories
  analysis.notableFiles = notableFiles
  analysis.fallbackOpportunities = fallbackOpportunities
  analysis.opportunities = fallbackOpportunities
  analysis.analysisSource = 'heuristic'
  analysis.analysisSummary = buildFallbackDriveSummary(drive, topEntries, fallbackOpportunities)
  analysis.aiGuidance = buildFallbackDriveGuidance(drive, fallbackOpportunities)
  analysis.aiStatus = aiConfig.enabled ? 'queued' : 'idle'
  analysis.aiError = null
  analysis.aiDurationMs = null

  syncDriveState(letter)
  enqueueAiTask({ kind: 'drive', letter, label: `${letter}: AI 解读` })
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
    analysis.scanError = error instanceof Error ? error.message : '扫描发生未知错误。'
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
  const aiResult = await analyzeDriveWithAi({
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
  })

  if (!aiResult) return

  analysis.opportunities = mergeOpportunities(
    aiResult.opportunities ?? [],
    analysis.fallbackOpportunities ?? [],
  )
  analysis.analysisSummary = aiResult.summary || analysis.analysisSummary
  analysis.aiGuidance =
    aiResult.guidance?.length > 0 ? aiResult.guidance : analysis.aiGuidance
  analysis.analysisSource = 'ai+heuristic'
  analysis.aiStatus = 'ready'
  analysis.aiDurationMs = Date.now() - startedAt
  analysis.lastAiAnalyzedAt = new Date().toISOString()
  analysis.aiError = null

  syncDriveState(letter)
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
  const result = await analyzeCrossDriveWithAi({
    drives: readyDrives,
    duplicateTopLevelNames: fallback.duplicateTopLevelNames,
    topOpportunities: fallback.topOpportunities,
    fallbackSuggestions: fallback.fallbackSuggestions,
  })

  if (!result) return

  state.crossDriveAi = {
    summary: result.summary ?? '',
    standardizationSuggestions: result.standardizationSuggestions ?? [],
    updatedAt: new Date().toISOString(),
  }
  state.system.aiLastAnalyzedAt = state.crossDriveAi.updatedAt
  await refreshLiveSystem()
}

async function processAiQueue() {
  if (activeAiTask || state.aiQueue.length === 0 || !aiConfig.enabled) return

  const task = state.aiQueue.shift()
  if (!task) return

  activeAiTask = task
  syncSystemState({ aiStatus: '分析中', aiLastError: null })

  try {
    if (task.kind === 'drive') {
      await runDriveAiTask(task.letter)
    } else if (task.kind === 'cross') {
      await runCrossDriveAiTask()
    }

    syncSystemState({
      aiStatus: state.aiQueue.length > 0 ? '排队中' : '就绪',
      aiLastError: null,
      aiLastAnalyzedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 分析失败。'

    if (task.kind === 'drive') {
      const analysis = ensureAnalysis(task.letter)
      analysis.aiStatus = 'error'
      analysis.aiError = message
      syncDriveState(task.letter)
    }

    syncSystemState({
      aiStatus: '降级',
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
  }
}

app.get('/api/snapshot', (_req, res) => {
  res.json(snapshotPayload())
})

app.post('/api/rescan', async (req, res) => {
  const requested = String(req.body?.drive ?? '').trim().toUpperCase()
  if (!requested || !/^[A-Z]$/.test(requested)) {
    res.status(400).json({ ok: false, message: '需要提供有效的盘符字母。' })
    return
  }

  const analysis = ensureAnalysis(requested)
  analysis.scanStatus = 'queued'
  analysis.aiStatus = aiConfig.enabled ? 'idle' : 'idle'
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
    res.status(400).json({ ok: false, message: '需要提供有效的盘符字母。' })
    return
  }

  if (!message) {
    res.status(400).json({ ok: false, message: '请输入问题内容。' })
    return
  }

  if (!aiConfig.enabled) {
    res.status(400).json({ ok: false, message: '当前未启用 DeepSeek，对话能力不可用。' })
    return
  }

  const drive = state.drives.find((item) => item.letter === driveLetter)
  const analysis = ensureAnalysis(driveLetter)
  if (!drive || analysis.scanStatus !== 'ready') {
    res.status(400).json({ ok: false, message: '该盘尚未完成扫描，暂时不能进行对话。' })
    return
  }

  try {
    const reply = await chatWithDriveContext({
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
    })

    res.json({ ok: true, reply })
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : 'AI 对话失败。',
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
    console.log(`Aegis Disk Command 已启动: http://127.0.0.1:${PORT}`)
  })
}

boot().catch((error) => {
  console.error('Aegis Disk Command 启动失败:', error)
  process.exitCode = 1
})
