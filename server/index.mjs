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

function inspectName(rawName) {
  const name = rawName.toLowerCase()

  if (name.includes('$recycle')) {
    return {
      category: 'reclaim',
      title: 'Recycle queue ready for purge',
      action: 'Empty recycle content after confirming nothing needs recovery.',
      weight: 2.7,
    }
  }

  if (
    name.includes('cache') ||
    name.includes('temp') ||
    name.includes('deliveryoptimization')
  ) {
    return {
      category: 'cache',
      title: 'Cache-heavy area detected',
      action: 'Purge cache files or move hot caches to a dedicated utility zone.',
      weight: 1.9,
    }
  }

  if (
    name.includes('download') ||
    name.includes('softstore') ||
    name.includes('installer') ||
    name.includes('archive')
  ) {
    return {
      category: 'download',
      title: 'Installer and download depot',
      action: 'Deduplicate installers and keep only the versions still needed.',
      weight: 1.8,
    }
  }

  if (
    name.includes('video') ||
    name.includes('jiany') ||
    name.includes('bililive') ||
    name.includes('draft')
  ) {
    return {
      category: 'media',
      title: 'Large media production footprint',
      action: 'Archive finished media into cold storage and keep only active worksets local.',
      weight: 1.6,
    }
  }

  if (
    name.includes('docker') ||
    name.includes('wsl') ||
    name.includes('vhd') ||
    name.includes('vmdk') ||
    name.includes('emulator') ||
    name.includes('hyperv')
  ) {
    return {
      category: 'virtualization',
      title: 'Virtual disk or emulator payload',
      action: 'Confirm whether the VM image is still live before pruning or relocating it.',
      weight: 1.5,
    }
  }

  if (
    name.includes('huawei') ||
    name.includes('deveco') ||
    name.includes('openharmony') ||
    name.includes('sdk')
  ) {
    return {
      category: 'toolchain',
      title: 'Heavy SDK or toolchain zone',
      action: 'Consolidate toolchains to one managed root and retire dormant versions.',
      weight: 1.4,
    }
  }

  if (
    name.includes('onedrive') ||
    name.includes('desktop') ||
    name.includes('documents') ||
    name.includes('文档') ||
    name.includes('桌面')
  ) {
    return {
      category: 'sync',
      title: 'Cloud sync payload is carrying large content',
      action: 'Move large transient files out of synced folders to reduce sync pressure.',
      weight: 1.4,
    }
  }

  if (name.includes('steam') || name.includes('wegame') || name.includes('mihoyo')) {
    return {
      category: 'games',
      title: 'Major game library footprint',
      action: 'Rationalize libraries and avoid keeping duplicate platform installs.',
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
      title: 'Unify download depots',
      detail:
        'Route installer archives, BaiduNetdisk drops, Lenovo package downloads, and ad-hoc setup files into one managed archive root.',
    },
    {
      title: 'Separate sync zones from transient data',
      detail:
        'Keep datasets, screen captures, and installer bundles out of OneDrive-managed surfaces so cloud sync stays intentional.',
    },
    {
      title: 'Collapse duplicate toolchains',
      detail:
        'DevEco, Huawei SDKs, OpenHarmony resources, and emulator images should live in one canonical tools root with archived versions outside the active path.',
    },
    {
      title: 'Normalize game libraries by platform',
      detail:
        'Use one platform library per title and avoid parallel standalone, Steam, and WeGame copies of the same game.',
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
        fsType: item.type || item.fsType || 'unknown',
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
      scanError:
        error instanceof Error ? error.message : 'Drive scan failed unexpectedly.',
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
    res.status(400).json({ ok: false, message: 'A valid drive letter is required.' })
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
    console.log(`Disk Command Cockpit server listening on http://127.0.0.1:${PORT}`)
  })
}

boot().catch((error) => {
  console.error('Failed to boot Disk Command Cockpit:', error)
  process.exitCode = 1
})
