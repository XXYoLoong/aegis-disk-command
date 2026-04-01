import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import si from 'systeminformation'
import {
  analyzeCrossDriveWithAi,
  analyzeDriveWithAi,
  getAiRuntimeConfig,
} from './ai-analysis.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distRoot = path.join(projectRoot, 'dist')
const scanScript = path.join(__dirname, 'scan-drive.ps1')
const execFileAsync = promisify(execFile)
const app = express()

const PORT = Number(process.env.PORT ?? 5525)
const LIVE_REFRESH_MS = 5000
const ANALYSIS_STALE_MS = 1000 * 60 * 8
const MAX_HISTORY_POINTS = 120
const DRIVE_AI_LIMIT = 10
const CROSS_DRIVE_AI_REFRESH_MS = 1000 * 30
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
    activeScan: null,
    historySamples: 0,
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

let crossDriveRefreshPromise = null

app.use(express.json())

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function bytes(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

  return merged
    .sort((a, b) => b.estimatedBytes - a.estimatedBytes)
    .slice(0, DRIVE_AI_LIMIT)
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
    summary: state.crossDriveAi.summary || '',
    fallbackSuggestions,
  }
}

function updateAiState(partial) {
  state.system = {
    ...state.system,
    analysisEngine: aiConfig.enabled ? 'DeepSeek + 规则兜底' : '规则启发式',
    aiEnabled: aiConfig.enabled,
    aiProvider: aiConfig.provider,
    aiModel: aiConfig.enabled ? aiConfig.model : null,
    ...partial,
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
      const analysis = state.analyses.get(letter)
      const totalBytes = bytes(item.size)
      const usedBytes = bytes(item.used)
      const freeBytes = Math.max(totalBytes - usedBytes, 0)
      const usePercent = totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100

      return {
        letter,
        mount,
        fsType: item.type || item.fsType || '未知',
        totalBytes,
        usedBytes,
        freeBytes,
        usePercent,
        health: classifyDriveHealth(usePercent),
        analysisStatus: analysis?.analysisStatus ?? 'queued',
        lastScannedAt: analysis?.lastScannedAt ?? null,
        scanDurationMs: analysis?.scanDurationMs ?? null,
        scanError: analysis?.scanError ?? null,
        topEntries: analysis?.topEntries ?? [],
        focusDirectories: analysis?.focusDirectories ?? [],
        notableFiles: analysis?.notableFiles ?? [],
        opportunities: analysis?.opportunities ?? [],
        analysisSource: analysis?.analysisSource ?? 'heuristic',
        analysisSummary: analysis?.analysisSummary ?? '',
        aiGuidance: analysis?.aiGuidance ?? [],
      }
    })
    .sort((a, b) => a.letter.localeCompare(b.letter))

  for (const drive of drives) {
    const stale =
      !drive.lastScannedAt ||
      Date.now() - new Date(drive.lastScannedAt).getTime() > ANALYSIS_STALE_MS

    if (
      stale &&
      !state.scanQueue.includes(drive.letter) &&
      state.system.activeScan !== drive.letter
    ) {
      state.scanQueue.push(drive.letter)
    }
  }

  const totalBytes = drives.reduce((sum, drive) => sum + drive.totalBytes, 0)
  const usedBytes = drives.reduce((sum, drive) => sum + drive.usedBytes, 0)
  const freeBytes = drives.reduce((sum, drive) => sum + drive.freeBytes, 0)
  const crossDrive = deriveCrossDrive(drives)

  state.generatedAt = new Date().toISOString()
  state.drives = drives
  state.system = {
    ...state.system,
    hostName: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuLoadPercent: currentLoad.currentLoad,
    memoryUsedPercent: mem.total === 0 ? 0 : (mem.used / mem.total) * 100,
    totalBytes,
    usedBytes,
    freeBytes,
    driveCount: drives.length,
    queueDepth: state.scanQueue.length,
    activeScan: state.system.activeScan,
    historySamples: Math.min(MAX_HISTORY_POINTS, state.system.historySamples + 1),
    uptimeMinutes: Math.floor((Date.now() - state.bootedAt) / 60000),
  }
  state.crossDrive = {
    duplicateTopLevelNames: crossDrive.duplicateTopLevelNames,
    standardizationSuggestions: crossDrive.standardizationSuggestions,
    topOpportunities: crossDrive.topOpportunities,
    summary: crossDrive.summary,
  }
}

async function refreshCrossDriveInsights() {
  if (!aiConfig.enabled) return

  const now = Date.now()
  const lastUpdatedAt = state.crossDriveAi.updatedAt
    ? new Date(state.crossDriveAi.updatedAt).getTime()
    : 0

  if (crossDriveRefreshPromise) return crossDriveRefreshPromise
  if (lastUpdatedAt && now - lastUpdatedAt < CROSS_DRIVE_AI_REFRESH_MS) return

  const fallback = deriveCrossDrive(state.drives)
  const readyDrives = state.drives
    .filter((drive) => drive.analysisStatus === 'ready')
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

  crossDriveRefreshPromise = (async () => {
    try {
      const aiResult = await analyzeCrossDriveWithAi({
        drives: readyDrives,
        duplicateTopLevelNames: fallback.duplicateTopLevelNames,
        topOpportunities: fallback.topOpportunities,
        fallbackSuggestions: fallback.fallbackSuggestions,
      })

      if (aiResult?.standardizationSuggestions?.length) {
        state.crossDriveAi = {
          summary: aiResult.summary ?? '',
          standardizationSuggestions: aiResult.standardizationSuggestions,
          updatedAt: new Date().toISOString(),
        }

        updateAiState({
          aiStatus: '就绪',
          aiLastError: null,
          aiLastAnalyzedAt: state.crossDriveAi.updatedAt,
        })

        await refreshLiveSystem()
      }
    } catch (error) {
      updateAiState({
        aiStatus: '降级',
        aiLastError:
          error instanceof Error ? error.message.slice(0, 240) : '跨盘 AI 分析失败。',
      })
    } finally {
      crossDriveRefreshPromise = null
    }
  })()

  return crossDriveRefreshPromise
}

async function scanDrive(letter) {
  const startedAt = Date.now()
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scanScript,
    '-DriveLetter',
    letter,
  ]

  const { stdout } = await execFileAsync('powershell', args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 12,
    timeout: 1000 * 60 * 10,
  })

  const raw = JSON.parse(stdout.trim())
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
  ]).sort((a, b) => b.estimatedBytes - a.estimatedBytes)

  const driveState =
    state.drives.find((drive) => drive.letter === letter) ?? {
      letter,
      fsType: '未知',
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      usePercent: 0,
    }

  let aiResult = null
  if (aiConfig.enabled) {
    try {
      aiResult = await analyzeDriveWithAi({
        drive: {
          letter,
          fsType: driveState.fsType,
          totalBytes: driveState.totalBytes,
          usedBytes: driveState.usedBytes,
          freeBytes: driveState.freeBytes,
          usePercent: driveState.usePercent,
        },
        topEntries: topEntries.slice(0, 8),
        focusDirectories: focusDirectories
          .slice(0, 4)
          .map((group) => ({ ...group, children: group.children.slice(0, 5) })),
        notableFiles: notableFiles.slice(0, 6),
        fallbackOpportunities: fallbackOpportunities.slice(0, 6),
      })

      updateAiState({
        aiStatus: '就绪',
        aiLastError: null,
        aiLastAnalyzedAt: new Date().toISOString(),
      })
    } catch (error) {
      updateAiState({
        aiStatus: '降级',
        aiLastError: error instanceof Error ? error.message.slice(0, 240) : '单盘 AI 分析失败。',
      })
    }
  }

  const opportunities = mergeOpportunities(aiResult?.opportunities ?? [], fallbackOpportunities)

  state.analyses.set(letter, {
    analysisStatus: 'ready',
    lastScannedAt: new Date().toISOString(),
    scanDurationMs: Date.now() - startedAt,
    scanError: null,
    topEntries,
    focusDirectories,
    notableFiles,
    opportunities,
    analysisSource: aiResult ? 'ai+heuristic' : 'heuristic',
    analysisSummary: aiResult?.summary ?? '',
    aiGuidance: aiResult?.guidance ?? [],
  })
}

async function processQueue() {
  if (state.system.activeScan || state.scanQueue.length === 0) return

  const letter = state.scanQueue.shift()
  if (!letter) return

  state.system.activeScan = letter
  const previous = state.analyses.get(letter) ?? {}
  state.analyses.set(letter, {
    ...previous,
    analysisStatus: 'scanning',
    scanError: null,
  })

  try {
    await scanDrive(letter)
    await refreshLiveSystem()
    refreshCrossDriveInsights().catch(() => {})
  } catch (error) {
    state.analyses.set(letter, {
      ...previous,
      analysisStatus: 'error',
      lastScannedAt: previous.lastScannedAt ?? null,
      scanDurationMs: null,
      scanError: error instanceof Error ? error.message : '磁盘扫描发生未知错误。',
      topEntries: previous.topEntries ?? [],
      focusDirectories: previous.focusDirectories ?? [],
      notableFiles: previous.notableFiles ?? [],
      opportunities: previous.opportunities ?? [],
      analysisSource: previous.analysisSource ?? 'heuristic',
      analysisSummary: previous.analysisSummary ?? '',
      aiGuidance: previous.aiGuidance ?? [],
    })
  } finally {
    state.system.activeScan = null
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

  if (!state.scanQueue.includes(requested) && state.system.activeScan !== requested) {
    state.scanQueue.unshift(requested)
  }

  await refreshLiveSystem()
  res.json({ ok: true, queued: formatQueueEntry(requested) })
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    generatedAt: state.generatedAt,
    activeScan: state.system.activeScan,
    queueDepth: state.scanQueue.length,
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
  processQueue().catch(() => {})
  refreshCrossDriveInsights().catch(() => {})

  setInterval(() => {
    refreshLiveSystem().catch(() => {})
  }, LIVE_REFRESH_MS)

  setInterval(() => {
    processQueue().catch(() => {})
  }, 1500)

  app.listen(PORT, () => {
    console.log(`Aegis Disk Command 已启动: http://127.0.0.1:${PORT}`)
  })
}

boot().catch((error) => {
  console.error('Aegis Disk Command 启动失败:', error)
  process.exitCode = 1
})
