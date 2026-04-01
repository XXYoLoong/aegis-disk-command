import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import si from 'systeminformation'

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
  },
  drives: [],
  analyses: new Map(),
  scanQueue: [],
  crossDrive: {
    duplicateTopLevelNames: [],
    standardizationSuggestions: [],
    topOpportunities: [],
  },
}

app.use(express.json())

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

function bytes(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
  const name = rawName.toLowerCase()

  if (includesAny(name, ['$recycle', '回收站'])) {
    return {
      category: 'reclaim',
      title: '回收区可直接回收',
      action: '确认没有需要恢复的文件后，可优先清空这一块内容，通常风险最低、释放最快。',
      weight: 2.7,
    }
  }

  if (
    includesAny(name, [
      'cache',
      'temp',
      'deliveryoptimization',
      '缓存',
      '临时',
      'tmp',
      'logs',
    ])
  ) {
    return {
      category: 'cache',
      title: '检测到高占用缓存区',
      action: '优先确认是否属于缓存、日志或临时文件，能删的删，常驻缓存建议归并到专门的缓存区。',
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
      '软件包',
    ])
  ) {
    return {
      category: 'download',
      title: '下载仓或安装包堆积',
      action: '建议去重保留仍需使用的版本，其余安装包、镜像和历史归档可转移或清理。',
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
      title: '媒体生产区占用较高',
      action: '已完成的录屏、素材和中间产物建议转入冷存储，本地只保留正在编辑的工作集。',
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
      title: '虚拟磁盘或模拟器负载',
      action: '先确认镜像是否仍在使用，再决定精简、归档或迁移，避免误删正在运行的环境。',
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
      '工具链',
      '开发',
    ])
  ) {
    return {
      category: 'toolchain',
      title: '工具链或 SDK 区域偏重',
      action: '建议把 DevEco、Huawei SDK、OpenHarmony 和模拟器资源归并到统一工具根目录，停用版本转入归档层。',
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
      action: '建议把大体积临时文件、安装包和素材移出同步区，避免云同步长期承压。',
      weight: 1.4,
    }
  }

  if (includesAny(name, ['steam', 'wegame', 'mihoyo', 'game', '游戏'])) {
    return {
      category: 'games',
      title: '游戏库占用明显',
      action: '建议按平台统一管理游戏库，避免同一游戏在独立版、Steam、WeGame 等多处重复安装。',
      weight: 1.2,
    }
  }

  return null
}

function buildOpportunities(letter, entries) {
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

  const standardizationSuggestions = [
    {
      title: '统一下载仓入口',
      detail:
        '安装包、网盘落地文件、LenovoSoftstore 下载物和临时 setup 建议汇总到一个受控归档根目录，避免多盘散落。',
    },
    {
      title: '同步区和临时区分层',
      detail:
        'OneDrive、桌面、文档等同步面只保留明确需要云同步的内容，大型素材、录屏和安装包不要长期停留在同步目录。',
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

  const topOpportunities = drives
    .flatMap((drive) => drive.opportunities ?? [])
    .sort((a, b) => b.estimatedBytes - a.estimatedBytes)
    .slice(0, 14)

  return {
    duplicateTopLevelNames,
    standardizationSuggestions,
    topOpportunities,
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

  state.generatedAt = new Date().toISOString()
  state.drives = drives
  state.system = {
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
  state.crossDrive = deriveCrossDrive(drives)
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

  const opportunities = buildOpportunities(letter, [
    ...topEntries,
    ...focusDirectories.flatMap((group) => group.children ?? []),
  ]).sort((a, b) => b.estimatedBytes - a.estimatedBytes)

  state.analyses.set(letter, {
    analysisStatus: 'ready',
    lastScannedAt: new Date().toISOString(),
    scanDurationMs: Date.now() - startedAt,
    scanError: null,
    topEntries,
    focusDirectories,
    notableFiles,
    opportunities,
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
