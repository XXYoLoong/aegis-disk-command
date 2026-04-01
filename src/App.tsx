import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  startTransition,
  type CSSProperties,
  type ReactNode,
} from 'react'
import './index.css'
import type {
  DriveHistoryMap,
  DriveSnapshot,
  DuplicateNameGroup,
  Entry,
  Opportunity,
  Snapshot,
  StandardizationSuggestion,
} from './types'
import {
  formatBytes,
  formatNumber,
  formatPercent,
  formatUpdatedAt,
  shortPath,
} from './lib/format'

const DRIVE_COLORS = ['#61e1ff', '#7d8cff', '#9f78ff', '#3ad4c9', '#57b8ff', '#ba84ff']

function pickDriveColor(letter: string) {
  return DRIVE_COLORS[letter.charCodeAt(0) % DRIVE_COLORS.length]
}

function pickDefaultDrive(drives: DriveSnapshot[]) {
  const ranked = [...drives]
  const ready = ranked.filter((drive) => drive.analysisStatus === 'ready' && drive.topEntries.length)
  const pool = ready.length ? ready : ranked
  return pool.sort((a, b) => b.usePercent - a.usePercent)[0]?.letter ?? ''
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
    next[drive.letter] = points.slice(-72)
  }

  return next
}

function gaugeStyle(letter: string, value: number): CSSProperties {
  return {
    '--drive-accent': pickDriveColor(letter),
    '--usage-angle': `${Math.max(8, Math.min(100, value)) * 3.6}deg`,
  } as CSSProperties
}

function toneClass(tone: string) {
  return `tone-${tone}`
}

function labelDriveHealth(health: string) {
  if (health === 'critical') return '严重'
  if (health === 'warning') return '预警'
  return '稳定'
}

function labelAnalysisStatus(status: string) {
  if (status === 'ready') return '已就绪'
  if (status === 'scanning') return '扫描中'
  if (status === 'error') return '异常'
  return '排队中'
}

function analysisTone(status: string) {
  if (status === 'error') return 'critical'
  if (status === 'scanning') return 'warning'
  if (status === 'ready') return 'stable'
  return 'info'
}

function formatScanDuration(value: number | null) {
  if (!value) return '待分析'
  return `${(value / 1000).toFixed(1)} 秒`
}

function buildDriveGuidance(drive: DriveSnapshot) {
  const items = []

  if (drive.usePercent >= 92) {
    items.push({
      title: '可用余量已逼近极限',
      detail:
        '当前盘的安全缓冲已经很薄，优先检查回收站、安装包、下载归档和重复安装内容，先拿回最快释放空间的一批容量。',
      tone: 'critical',
    })
  } else if (drive.usePercent >= 82) {
    items.push({
      title: '已进入容量预警区间',
      detail:
        '暂时还能继续工作，但在下一次大型安装、素材导入或云同步高峰之前，最好先完成一轮有针对性的清理。',
      tone: 'warning',
    })
  } else {
    items.push({
      title: '当前盘面余量相对稳定',
      detail:
        '这个盘还有比较从容的余量，可以把它作为跨盘标准化时的参考面，承接更明确的职责分区。',
      tone: 'stable',
    })
  }

  if (drive.analysisStatus !== 'ready') {
    items.push({
      title: '深度分析仍在持续补齐',
      detail:
        '容量遥测已经实时在线，目录密度、焦点目录和大文件工件会随着后台扫描完成逐步填充进来。',
      tone: 'info',
    })
  } else if (drive.opportunities.length) {
    items.push({
      title: '发现可执行的清理机会',
      detail:
        '当前盘已经识别出缓存区、下载仓、媒体中间件或工具链重复面，适合优先从高收益目录开始处理。',
      tone: 'warning',
    })
  }

  items.push({
    title: '尽量保持盘面角色单一',
    detail:
      drive.fsType === 'NTFS'
        ? '建议一个盘只承担一种主职责，比如游戏库、云同步、开发工具、归档仓或媒体生产。角色混杂越多，后续越容易出现碎片化和漂移。'
        : '尽量让文件系统边界保持清晰，这样清理和迁移决策会更稳定，也更不容易误伤正在使用的内容。',
    tone: 'info',
  })

  return items
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<DriveHistoryMap>({})
  const [selectedDrive, setSelectedDrive] = useState('')
  const [fetchError, setFetchError] = useState('')
  const [rescanTarget, setRescanTarget] = useState('')

  const applySnapshot = useEffectEvent((data: Snapshot) => {
    setFetchError('')

    startTransition(() => {
      setSnapshot(data)
      setHistory((previous) => appendHistory(previous, data))
    })
  })

  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch('/api/snapshot', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`快照请求失败，状态码 ${response.status}。`)
        }

        const data = (await response.json()) as Snapshot
        applySnapshot(data)
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : '无法连接本地磁盘分析服务。')
      }
    }

    run()
    const interval = window.setInterval(() => {
      run()
    }, 5000)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!snapshot?.drives.length) return

    const stillExists = snapshot.drives.some((drive) => drive.letter === selectedDrive)
    const active = snapshot.drives.find((drive) => drive.letter === selectedDrive)
    const readyCandidate = pickDefaultDrive(snapshot.drives)

    if (
      !selectedDrive ||
      !stillExists ||
      (active && active.analysisStatus !== 'ready' && readyCandidate && readyCandidate !== selectedDrive)
    ) {
      setSelectedDrive(pickDefaultDrive(snapshot.drives))
    }
  }, [selectedDrive, snapshot])

  const deferredSnapshot = useDeferredValue(snapshot)
  const drives = deferredSnapshot?.drives ?? []
  const activeDrive =
    drives.find((drive) => drive.letter === selectedDrive) ?? drives[0] ?? null
  const topOpportunities = deferredSnapshot?.crossDrive.topOpportunities ?? []
  const duplicates = deferredSnapshot?.crossDrive.duplicateTopLevelNames ?? []
  const standards = deferredSnapshot?.crossDrive.standardizationSuggestions ?? []
  const liveClock = deferredSnapshot?.generatedAt
    ? formatUpdatedAt(deferredSnapshot.generatedAt)
    : '启动中'
  const driveGuidance = activeDrive ? buildDriveGuidance(activeDrive) : []

  async function queueRescan(letter: string) {
    try {
      setRescanTarget(letter)
      await fetch('/api/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drive: letter }),
      })
    } finally {
      setRescanTarget('')
    }
  }

  if (!deferredSnapshot) {
    return (
      <div className="app-shell">
        <BackgroundField />
        <main className="loading-stage">
          <div className="boot-ring" />
          <p>正在初始化本地磁盘遥测网格...</p>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <BackgroundField />

      <header className="top-band">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <p className="eyebrow">本地磁盘指挥舱</p>
            <h1>Aegis Disk Command</h1>
          </div>
        </div>

        <div className="global-metrics">
          <MetricCard
            label="总容量"
            value={formatBytes(deferredSnapshot.system.totalBytes)}
            hint={`在线磁盘 ${deferredSnapshot.system.driveCount} 个`}
          />
          <MetricCard
            label="当前剩余"
            value={formatBytes(deferredSnapshot.system.freeBytes)}
            hint={formatPercent(
              deferredSnapshot.system.totalBytes === 0
                ? 0
                : (deferredSnapshot.system.freeBytes / deferredSnapshot.system.totalBytes) * 100,
            )}
          />
          <MetricCard
            label="CPU 脉冲"
            value={formatPercent(deferredSnapshot.system.cpuLoadPercent)}
            hint={`内存占用 ${formatPercent(deferredSnapshot.system.memoryUsedPercent)}`}
          />
          <MetricCard
            label="扫描队列"
            value={formatNumber(deferredSnapshot.system.queueDepth)}
            hint={
              deferredSnapshot.system.activeScan
                ? `${deferredSnapshot.system.activeScan}: 扫描中`
                : '空闲'
            }
          />
          <MetricCard
            label="刷新时间"
            value={liveClock}
            hint={`保留样本 ${deferredSnapshot.system.historySamples} 条`}
          />
        </div>
      </header>

      <section className="drive-ribbon">
        {drives.map((drive) => (
          <button
            key={drive.letter}
            className={`drive-tile ${selectedDrive === drive.letter ? 'is-selected' : ''}`}
            onClick={() => setSelectedDrive(drive.letter)}
            style={gaugeStyle(drive.letter, drive.usePercent)}
          >
            <div className="drive-tile__head">
              <span className={`status-dot ${toneClass(drive.health)}`} />
              <strong>{drive.letter}:</strong>
              <span>{drive.fsType}</span>
            </div>
            <div className="drive-tile__meter">
              <span style={{ width: `${drive.usePercent}%` }} />
            </div>
            <div className="drive-tile__values">
              <b>{formatPercent(drive.usePercent)}</b>
              <small>剩余 {formatBytes(drive.freeBytes)}</small>
            </div>
          </button>
        ))}
      </section>

      <main className="console-grid">
        <section className="panel panel-stack panel-left">
          <PanelHeader
            eyebrow="运行队列"
            title="清理压力"
            detail="根据实时扫描识别出的高收益机会位。"
          />
          <OpportunityList items={topOpportunities.slice(0, 7)} />
        </section>

        <section className="panel panel-main">
          {activeDrive && (
            <>
              <PanelHeader
                eyebrow="中央分析核心"
                title={`${activeDrive.letter}: 盘面中枢`}
                detail={`已用 ${formatBytes(activeDrive.usedBytes)} / 总量 ${formatBytes(activeDrive.totalBytes)}，更新于 ${formatUpdatedAt(activeDrive.lastScannedAt)}`}
                action={
                  <button
                    className="ghost-button"
                    disabled={rescanTarget === activeDrive.letter}
                    onClick={() => queueRescan(activeDrive.letter)}
                  >
                    {rescanTarget === activeDrive.letter ? '已加入队列...' : '重新扫描'}
                  </button>
                }
              />

              <div className="main-panel-grid">
                <div className="core-orbital">
                  <div
                    className="drive-orb"
                    style={gaugeStyle(activeDrive.letter, activeDrive.usePercent)}
                  >
                    <div className="drive-orb__inner">
                      <span className="eyebrow">占用包络</span>
                      <strong>{formatPercent(activeDrive.usePercent)}</strong>
                      <small>可用余量 {formatBytes(activeDrive.freeBytes)}</small>
                    </div>
                  </div>

                  <div className="orbital-stats">
                    <StatLine
                      label="健康等级"
                      value={labelDriveHealth(activeDrive.health)}
                      tone={activeDrive.health}
                    />
                    <StatLine
                      label="分析状态"
                      value={labelAnalysisStatus(activeDrive.analysisStatus)}
                      tone={analysisTone(activeDrive.analysisStatus)}
                    />
                    <StatLine
                      label="扫描耗时"
                      value={formatScanDuration(activeDrive.scanDurationMs)}
                    />
                    <StatLine label="文件系统" value={activeDrive.fsType} />
                  </div>
                </div>

                <div className="trend-stage">
                  <h3>全盘剩余空间时间线</h3>
                  <p>每 5 秒保留一次剩余容量变化，用于观察各盘的实时压力走势。</p>
                  <TrendChart drives={drives} history={history} />
                </div>
              </div>

              <div className="data-row">
                <div className="subpanel">
                  <h3>根目录密度图</h3>
                  <p>展示当前盘根目录下占用最高的一层结构。</p>
                  <EntryBars
                    entries={activeDrive.topEntries.slice(0, 8)}
                    totalBytes={activeDrive.totalBytes}
                  />
                </div>

                <div className="subpanel">
                  <h3>焦点目录</h3>
                  <p>继续向下展开一层，定位最重区域的内部构成。</p>
                  <FocusDirectoryList groups={activeDrive.focusDirectories.slice(0, 4)} />
                </div>
              </div>

              <div className="data-row">
                <div className="subpanel">
                  <h3>盘面建议</h3>
                  <p>根据当前盘状态动态生成的处理方向。</p>
                  <GuidanceDeck items={driveGuidance} />
                </div>

                <div className="subpanel">
                  <h3>当前盘机会队列</h3>
                  <p>选中盘内识别出的缓存、下载仓和重复面线索。</p>
                  <OpportunityList items={activeDrive.opportunities.slice(0, 4)} />
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel panel-stack panel-right">
          <PanelHeader
            eyebrow="拓扑信号"
            title="跨盘结构"
            detail="查看重名顶层目录和标准化整理方向。"
          />
          <DuplicateList items={duplicates.slice(0, 6)} />
          <div className="divider" />
          <StandardList items={standards} />
        </section>

        <section className="panel panel-bottom-left">
          <PanelHeader
            eyebrow="可见工件"
            title="当前视图中的大文件"
            detail="来自根目录与焦点目录的一批高占用文件。"
          />
          <FileList items={activeDrive?.notableFiles ?? []} />
        </section>

        <section className="panel panel-bottom-right">
          <PanelHeader
            eyebrow="系统中继"
            title="运行状态"
            detail="本地监控栈的实时服务状态与刷新情况。"
          />
          <RuntimeCluster snapshot={deferredSnapshot} fetchError={fetchError} />
        </section>
      </main>
    </div>
  )
}

function BackgroundField() {
  return (
    <div className="background-field" aria-hidden="true">
      <div className="background-field__halo background-field__halo--left" />
      <div className="background-field__halo background-field__halo--right" />
      <div className="background-field__grid" />
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  )
}

function PanelHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string
  title: string
  detail: string
  action?: ReactNode
}) {
  return (
    <header className="panel-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="panel-header__detail">{detail}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  )
}

function StatLine({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="stat-line">
      <span>{label}</span>
      <strong className={toneClass(tone)}>{value}</strong>
    </div>
  )
}

function OpportunityList({ items }: { items: Opportunity[] }) {
  if (!items.length) {
    return <EmptyState label="暂未发现新的清理信号，后台分析仍在持续补齐。" />
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <article key={item.id} className="signal-item">
          <div className="signal-item__head">
            <span className={`status-dot ${toneClass(item.severity)}`} />
            <strong>{item.title}</strong>
            <small>{item.drive}:</small>
          </div>
          <p>{item.action}</p>
          <div className="signal-item__foot">
            <span>{shortPath(item.path)}</span>
            <b>{formatBytes(item.estimatedBytes)}</b>
          </div>
        </article>
      ))}
    </div>
  )
}

function EntryBars({
  entries,
  totalBytes,
}: {
  entries: Entry[]
  totalBytes: number
}) {
  if (!entries.length) {
    return <EmptyState label="正在等待目录频谱完成首轮构建..." />
  }

  return (
    <div className="bars-list">
      {entries.map((entry) => {
        const share = totalBytes === 0 ? 0 : (entry.sizeBytes / totalBytes) * 100
        return (
          <div key={entry.path} className="bar-item">
            <div className="bar-item__copy">
              <strong>{entry.name}</strong>
              <span>{shortPath(entry.path)}</span>
            </div>
            <div className="bar-track">
              <span style={{ width: `${Math.max(2, share)}%` }} />
            </div>
            <b>{formatBytes(entry.sizeBytes)}</b>
          </div>
        )
      })}
    </div>
  )
}

function FocusDirectoryList({ groups }: { groups: DriveSnapshot['focusDirectories'] }) {
  if (!groups.length) {
    return <EmptyState label="首次深度扫描完成后，这里会显示更细的内部结构。" />
  }

  return (
    <div className="focus-grid">
      {groups.map((group) => (
        <article key={group.path} className="focus-card">
          <header>
            <strong>{group.name}</strong>
            <span>{formatBytes(group.sizeBytes)}</span>
          </header>
          <ul>
            {group.children.slice(0, 5).map((child) => (
              <li key={child.path}>
                <span>{child.name}</span>
                <b>{formatBytes(child.sizeBytes)}</b>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}

function DuplicateList({ items }: { items: DuplicateNameGroup[] }) {
  if (!items.length) {
    return <EmptyState label="当前还没有识别出明显的跨盘重名顶层目录。" />
  }

  return (
    <div className="stack-list compact">
      {items.map((item) => (
        <article key={item.name} className="signal-item">
          <div className="signal-item__head">
            <strong>{item.name}</strong>
            <small>{item.drives.map((drive) => `${drive}:`).join(' / ')}</small>
          </div>
          <p>{shortPath(item.paths.join(' | '))}</p>
          <div className="signal-item__foot">
            <span>合计占用</span>
            <b>{formatBytes(item.combinedBytes)}</b>
          </div>
        </article>
      ))}
    </div>
  )
}

function StandardList({ items }: { items: StandardizationSuggestion[] }) {
  if (!items.length) {
    return <EmptyState label="跨盘标准化建议会在分析完成后显示。" />
  }

  return (
    <div className="standards-list">
      {items.map((item) => (
        <article key={item.title} className="standard-item">
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  )
}

function FileList({ items }: { items: Entry[] }) {
  if (!items.length) {
    return <EmptyState label="暂未浮现新的大文件工件。" />
  }

  return (
    <div className="file-list">
      {items.map((item) => (
        <div key={item.path} className="file-row">
          <div>
            <strong>{item.name}</strong>
            <span>{shortPath(item.path)}</span>
          </div>
          <b>{formatBytes(item.sizeBytes)}</b>
        </div>
      ))}
    </div>
  )
}

function RuntimeCluster({
  snapshot,
  fetchError,
}: {
  snapshot: Snapshot
  fetchError: string
}) {
  return (
    <div className="runtime-grid">
      <StatLine label="主机名" value={snapshot.system.hostName} />
      <StatLine label="平台" value={snapshot.system.platform} />
      <StatLine label="运行时长" value={`${snapshot.system.uptimeMinutes} 分钟`} />
      <StatLine
        label="活动扫描"
        value={snapshot.system.activeScan ? `${snapshot.system.activeScan}: 扫描中` : '空闲'}
        tone={snapshot.system.activeScan ? 'warning' : 'stable'}
      />
      <StatLine
        label="拉取状态"
        value={fetchError ? '降级' : '正常'}
        tone={fetchError ? 'critical' : 'stable'}
      />
      <div className="runtime-note">
        {fetchError || '数据每 5 秒刷新一次，深度目录扫描会在后台轮转执行。'}
      </div>
    </div>
  )
}

function GuidanceDeck({
  items,
}: {
  items: Array<{ title: string; detail: string; tone: string }>
}) {
  return (
    <div className="standards-list">
      {items.map((item) => (
        <article key={item.title} className="standard-item">
          <div className="signal-item__head">
            <strong>{item.title}</strong>
            <span className={`status-dot ${toneClass(item.tone)}`} />
          </div>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  )
}

function TrendChart({
  drives,
  history,
}: {
  drives: DriveSnapshot[]
  history: DriveHistoryMap
}) {
  const width = 760
  const height = 240
  const padding = 18

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="全盘剩余空间时间线">
        {Array.from({ length: 5 }).map((_, index) => {
          const y = padding + ((height - padding * 2) / 4) * index
          return <line key={y} x1={padding} y1={y} x2={width - padding} y2={y} className="grid-line" />
        })}

        {drives.map((drive) => {
          const points = history[drive.letter] ?? []
          if (!points.length) return null

          const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0
          const path = points
            .map((point, index) => {
              const x = padding + step * index
              const y = padding + (1 - point.freePercent / 100) * (height - padding * 2)
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
            })
            .join(' ')

          return (
            <g key={drive.letter}>
              <path
                d={path}
                fill="none"
                stroke={pickDriveColor(drive.letter)}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="trend-line"
              />
            </g>
          )
        })}
      </svg>

      <div className="trend-legend">
        {drives.map((drive) => (
          <div key={drive.letter} className="trend-legend__item">
            <span
              className="trend-legend__swatch"
              style={{ background: pickDriveColor(drive.letter) }}
            />
            <strong>{drive.letter}:</strong>
            <span>剩余 {formatBytes(drive.freeBytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>
}

export default App
