import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  startTransition,
  type CSSProperties,
} from 'react'
import './index.css'
import {
  AiView,
  ChatView,
  type ChatMessage,
  DriveView,
  EmptyState,
  MetricChip,
  OverviewView,
  ScanView,
  StatusBadge,
} from './components/CockpitViews'
import type { DriveHistoryMap, DriveSnapshot, Snapshot } from './types'
import { formatBytes, formatPercent, formatUpdatedAt } from './lib/format'

type ViewMode = 'overview' | 'drive' | 'scan' | 'ai' | 'chat'

const VIEWS: Array<{ id: ViewMode; label: string }> = [
  { id: 'overview', label: '全局中控' },
  { id: 'drive', label: '盘面细读' },
  { id: 'scan', label: '扫描流程' },
  { id: 'ai', label: 'AI 解读' },
  { id: 'chat', label: 'AI 对话' },
]

function pickDefaultDrive(drives: DriveSnapshot[]) {
  return [...drives].sort((a, b) => b.usePercent - a.usePercent)[0]?.letter ?? ''
}

function appendHistory(previous: DriveHistoryMap, snapshot: Snapshot) {
  const next: DriveHistoryMap = { ...previous }
  for (const drive of snapshot.drives) {
    const points = [...(previous[drive.letter] ?? [])]
    points.push({
      at: snapshot.generatedAt,
      freePercent: drive.totalBytes === 0 ? 0 : (drive.freeBytes / drive.totalBytes) * 100,
      usedPercent: drive.usePercent,
    })
    next[drive.letter] = points.slice(-120)
  }
  return next
}

function driveStyle(letter: string, usePercent: number) {
  const colors = ['#62e5ff', '#79a2ff', '#a586ff', '#36d6c5', '#4f8bff', '#7ce7ff']
  return {
    '--drive-accent': colors[letter.charCodeAt(0) % colors.length],
    '--meter-width': `${Math.max(4, Math.min(100, usePercent))}%`,
  } as CSSProperties
}

function hasLiveActivity(snapshot: Snapshot | null) {
  if (!snapshot) return true
  return Boolean(
    snapshot.system.activeScan ||
      snapshot.system.activeAi ||
      snapshot.drives.some((drive) => drive.scanStatus === 'scanning' || drive.aiStatus === 'analyzing'),
  )
}

function systemTone(snapshot: Snapshot | null) {
  if (!snapshot) return 'warning'
  if (snapshot.system.freeBytes < 20 * 1024 ** 3) return 'critical'
  if (snapshot.system.freeBytes < 80 * 1024 ** 3) return 'warning'
  return 'stable'
}

function scanBadgeTone(drive: DriveSnapshot) {
  if (drive.scanStatus === 'ready') return 'stable'
  if (drive.scanStatus === 'scanning') return 'info'
  if (drive.scanStatus === 'error') return 'critical'
  return 'warning'
}

function labelScanStatus(status: DriveSnapshot['scanStatus']) {
  if (status === 'ready') return '已完成'
  if (status === 'scanning') return '扫描中'
  if (status === 'error') return '异常'
  return '排队中'
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<DriveHistoryMap>({})
  const [selectedDrive, setSelectedDrive] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('overview')
  const [fetchError, setFetchError] = useState('')
  const [rescanTarget, setRescanTarget] = useState('')
  const [chatDraft, setChatDraft] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [chatByDrive, setChatByDrive] = useState<Record<string, ChatMessage[]>>({})
  const deferredSnapshot = useDeferredValue(snapshot)

  const refreshSnapshot = useEffectEvent(async () => {
    try {
      const response = await fetch('/api/snapshot')
      if (!response.ok) throw new Error('读取快照失败')
      const nextSnapshot = (await response.json()) as Snapshot

      startTransition(() => {
        setSnapshot(nextSnapshot)
        setHistory((previous) => appendHistory(previous, nextSnapshot))
      })

      setFetchError('')
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : '读取快照失败')
    }
  })

  useEffect(() => {
    void refreshSnapshot()
  }, [])

  useEffect(() => {
    const intervalMs = hasLiveActivity(snapshot) ? 1200 : 4000
    const timer = window.setInterval(() => {
      void refreshSnapshot()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [snapshot])

  useEffect(() => {
    if (!snapshot?.drives.length) return
    if (!selectedDrive || !snapshot.drives.some((drive) => drive.letter === selectedDrive)) {
      setSelectedDrive(pickDefaultDrive(snapshot.drives))
    }
  }, [selectedDrive, snapshot])

  async function queueRescan(letter: string) {
    setRescanTarget(letter)
    setChatError('')

    try {
      const response = await fetch('/api/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drive: letter }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.message ?? '重新扫描失败')
      }
      setViewMode('scan')
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : '重新扫描失败')
    } finally {
      setRescanTarget('')
    }
  }

  async function submitChat() {
    if (!selectedDrive || !chatDraft.trim()) return

    const message = chatDraft.trim()
    const historyItems = chatByDrive[selectedDrive] ?? []
    const nextHistory = [...historyItems, { role: 'user' as const, content: message }]

    setChatDraft('')
    setChatBusy(true)
    setChatError('')
    setChatByDrive((previous) => ({ ...previous, [selectedDrive]: nextHistory }))

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drive: selectedDrive,
          message,
          history: historyItems.slice(-8),
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data?.message ?? 'AI 对话失败')
      }

      setChatByDrive((previous) => ({
        ...previous,
        [selectedDrive]: [...(previous[selectedDrive] ?? []), { role: 'assistant', content: String(data.reply ?? '') }],
      }))
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'AI 对话失败')
    } finally {
      setChatBusy(false)
    }
  }

  if (!deferredSnapshot) {
    return (
      <div className="cockpit-shell">
        <div className="background-grid" />
        <main className="loading-state">
          <div className="loading-ring" />
          <p>正在初始化本地磁盘驾驶舱...</p>
        </main>
      </div>
    )
  }

  const activeDrive =
    deferredSnapshot.drives.find((drive) => drive.letter === selectedDrive) ??
    deferredSnapshot.drives[0] ??
    null
  const chatMessages = activeDrive ? chatByDrive[activeDrive.letter] ?? [] : []

  return (
    <div className="cockpit-shell">
      <div className="background-grid" />

      <header className="command-header">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <p className="brand-overline">LOCAL DISK COMMAND CENTER</p>
            <h1>Aegis Disk Command</h1>
            <p className="brand-copy">以总览中控为入口，向下切入单盘扫描、AI 解读与追问对话。</p>
          </div>
        </div>

        <div className="header-metrics">
          <MetricChip label="总容量" value={formatBytes(deferredSnapshot.system.totalBytes)} />
          <MetricChip label="当前剩余" value={formatBytes(deferredSnapshot.system.freeBytes)} />
          <MetricChip label="扫描队列" value={String(deferredSnapshot.system.scanQueueDepth)} />
          <MetricChip label="AI 队列" value={String(deferredSnapshot.system.aiQueueDepth)} />
          <MetricChip label="主机" value={deferredSnapshot.system.hostName} />
        </div>

        <nav className="view-tabs" aria-label="视图切换">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              className={`view-tab ${viewMode === view.id ? 'is-active' : ''}`}
              onClick={() => setViewMode(view.id)}
            >
              {view.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="workspace-shell">
        <aside className="drive-rail">
          <div className="rail-head">
            <span>盘符矩阵</span>
            <StatusBadge tone={systemTone(deferredSnapshot)}>
              {formatPercent(
                deferredSnapshot.system.totalBytes === 0
                  ? 0
                  : (deferredSnapshot.system.usedBytes / deferredSnapshot.system.totalBytes) * 100,
              )}
            </StatusBadge>
          </div>

          <div className="drive-list">
            {deferredSnapshot.drives.map((drive) => (
              <button
                key={drive.letter}
                className={`drive-card ${selectedDrive === drive.letter ? 'is-selected' : ''}`}
                onClick={() => setSelectedDrive(drive.letter)}
                style={driveStyle(drive.letter, drive.usePercent)}
              >
                <div className="drive-card__head">
                  <strong>{drive.letter}:</strong>
                  <StatusBadge tone={scanBadgeTone(drive)}>{labelScanStatus(drive.scanStatus)}</StatusBadge>
                </div>
                <div className="drive-card__meta">
                  <span>{drive.fsType}</span>
                  <span>{formatPercent(drive.usePercent)}</span>
                </div>
                <div className="drive-card__meter">
                  <span />
                </div>
                <small>剩余 {formatBytes(drive.freeBytes)}</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="workspace-main">
          {viewMode === 'overview' ? (
            <OverviewView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'drive' ? (
            <DriveView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'scan' ? (
            <ScanView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'ai' ? (
            <AiView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'chat' ? (
            <ChatView
              drive={activeDrive}
              draft={chatDraft}
              busy={chatBusy}
              error={chatError}
              messages={chatMessages}
              onDraftChange={setChatDraft}
              onSubmit={submitChat}
            />
          ) : null}
        </main>

        <aside className="inspector-rail">
          <section className="inspector-card">
            <div className="inspector-card__head">
              <span>系统状态</span>
              <StatusBadge tone={systemTone(deferredSnapshot)}>
                {deferredSnapshot.system.activeScan ? `扫描 ${deferredSnapshot.system.activeScan}:` : '空闲'}
              </StatusBadge>
            </div>
            <div className="metric-stack">
              <MetricChip label="AI 引擎" value={deferredSnapshot.system.analysisEngine} />
              <MetricChip label="AI 状态" value={deferredSnapshot.system.aiStatus} />
              <MetricChip label="最近刷新" value={formatUpdatedAt(deferredSnapshot.generatedAt)} />
              <MetricChip label="平台" value={deferredSnapshot.system.platform} />
            </div>
          </section>

          <section className="inspector-card">
            <div className="inspector-card__head">
              <span>当前盘摘要</span>
              {activeDrive ? <StatusBadge tone="info">{activeDrive.analysisSource}</StatusBadge> : null}
            </div>
            {activeDrive ? (
              <>
                <p className="inspector-copy">
                  {activeDrive.analysisSummary || '等待该盘扫描和 AI 结果返回后显示摘要。'}
                </p>
                <div className="metric-stack">
                  <MetricChip label="扫描完成" value={formatUpdatedAt(activeDrive.lastScannedAt)} />
                  <MetricChip label="AI 完成" value={formatUpdatedAt(activeDrive.lastAiAnalyzedAt)} />
                </div>
              </>
            ) : (
              <EmptyState title="暂无盘摘要" detail="选中盘符后，这里会显示 AI 与规则汇总的短摘要。" />
            )}
          </section>

          <section className="inspector-card">
            <div className="inspector-card__head">
              <span>跨盘总览</span>
            </div>
            <p className="inspector-copy">
              {deferredSnapshot.crossDrive.summary || '等待系统汇总跨盘关系后显示全局结论。'}
            </p>
            {fetchError ? <p className="inline-error">{fetchError}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  )
}
