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

function buildDriveGuidance(drive: DriveSnapshot) {
  const items = []

  if (drive.usePercent >= 92) {
    items.push({
      title: 'Reserve is critically thin',
      detail:
        'This drive is running below a comfortable safety margin. Prioritize recycle-bin release, duplicate install review, and installer/archive cleanup.',
      tone: 'critical',
    })
  } else if (drive.usePercent >= 82) {
    items.push({
      title: 'Reserve is entering the warning band',
      detail:
        'There is still room to operate, but cleanup should happen before the next large install, dataset import, or sync burst.',
      tone: 'warning',
    })
  } else {
    items.push({
      title: 'Operational reserve is stable',
      detail:
        'This drive still has runway. Use it as a reference point when standardizing folders across the rest of the fleet.',
      tone: 'stable',
    })
  }

  if (drive.analysisStatus !== 'ready') {
    items.push({
      title: 'Deep scan is still warming up',
      detail:
        'Immediate capacity telemetry is live now; directory density, focus layers, and artifact intelligence will fill in as the background scan completes.',
      tone: 'info',
    })
  } else if (drive.opportunities.length) {
    items.push({
      title: 'Actionable cleanup vectors detected',
      detail:
        'The latest scan found directories that look like caches, download depots, media payloads, or duplicated tool surfaces worth reviewing first.',
      tone: 'warning',
    })
  }

  items.push({
    title: 'Keep the filesystem role explicit',
    detail:
      drive.fsType === 'NTFS'
        ? 'Use this surface for one clear responsibility only: games, cloud sync, development, archives, or media production. Mixing all of them accelerates fragmentation and drift.'
        : 'Keep filesystem role boundaries sharp so cleanup decisions stay predictable and safe.',
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
          throw new Error(`Snapshot request failed with ${response.status}.`)
        }

        const data = (await response.json()) as Snapshot
        applySnapshot(data)
      } catch (error) {
        setFetchError(
          error instanceof Error ? error.message : 'Unable to reach the local disk service.',
        )
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
    if (!selectedDrive || !stillExists) {
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
  const liveClock = deferredSnapshot?.generatedAt ? formatUpdatedAt(deferredSnapshot.generatedAt) : 'Booting'
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
          <p>Initializing disk telemetry mesh...</p>
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
            <p className="eyebrow">LOCAL COMMAND SURFACE</p>
            <h1>Aegis Disk Command</h1>
          </div>
        </div>

        <div className="global-metrics">
          <MetricCard
            label="Fleet Capacity"
            value={formatBytes(deferredSnapshot.system.totalBytes)}
            hint={`${deferredSnapshot.system.driveCount} drives online`}
          />
          <MetricCard
            label="Free Reserve"
            value={formatBytes(deferredSnapshot.system.freeBytes)}
            hint={formatPercent(
              deferredSnapshot.system.totalBytes === 0
                ? 0
                : (deferredSnapshot.system.freeBytes / deferredSnapshot.system.totalBytes) * 100,
            )}
          />
          <MetricCard
            label="CPU Pulse"
            value={formatPercent(deferredSnapshot.system.cpuLoadPercent)}
            hint={`Memory ${formatPercent(deferredSnapshot.system.memoryUsedPercent)}`}
          />
          <MetricCard
            label="Scan Queue"
            value={formatNumber(deferredSnapshot.system.queueDepth)}
            hint={
              deferredSnapshot.system.activeScan
                ? `Scanning ${deferredSnapshot.system.activeScan}:`
                : 'Idle'
            }
          />
          <MetricCard
            label="Telemetry Stamp"
            value={liveClock}
            hint={`${deferredSnapshot.system.historySamples} samples retained`}
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
              <small>{formatBytes(drive.freeBytes)} free</small>
            </div>
          </button>
        ))}
      </section>

      <main className="console-grid">
        <section className="panel panel-stack panel-left">
          <PanelHeader
            eyebrow="Operational Queue"
            title="Cleanup Pressure"
            detail="High-yield targets inferred from live scans."
          />
          <OpportunityList items={topOpportunities.slice(0, 7)} />
        </section>

        <section className="panel panel-main">
          {activeDrive && (
            <>
              <PanelHeader
                eyebrow="Central Analysis Core"
                title={`${activeDrive.letter}: Drive Intelligence`}
                detail={`${formatBytes(activeDrive.usedBytes)} used of ${formatBytes(activeDrive.totalBytes)} · scanned ${formatUpdatedAt(activeDrive.lastScannedAt)}`}
                action={
                  <button
                    className="ghost-button"
                    disabled={rescanTarget === activeDrive.letter}
                    onClick={() => queueRescan(activeDrive.letter)}
                  >
                    {rescanTarget === activeDrive.letter ? 'Queueing…' : 'Rescan'}
                  </button>
                }
              />

              <div className="main-panel-grid">
                <div className="core-orbital">
                  <div className="drive-orb" style={gaugeStyle(activeDrive.letter, activeDrive.usePercent)}>
                    <div className="drive-orb__inner">
                      <span className="eyebrow">Usage Envelope</span>
                      <strong>{formatPercent(activeDrive.usePercent)}</strong>
                      <small>{formatBytes(activeDrive.freeBytes)} reserve</small>
                    </div>
                  </div>

                  <div className="orbital-stats">
                    <StatLine label="Health Band" value={activeDrive.health} tone={activeDrive.health} />
                    <StatLine label="Analysis State" value={activeDrive.analysisStatus} tone={activeDrive.analysisStatus === 'error' ? 'critical' : activeDrive.analysisStatus === 'scanning' ? 'warning' : 'stable'} />
                    <StatLine
                      label="Scan Span"
                      value={
                        activeDrive.scanDurationMs
                          ? `${(activeDrive.scanDurationMs / 1000).toFixed(1)} s`
                          : 'Pending'
                      }
                    />
                    <StatLine label="Filesystem" value={activeDrive.fsType} />
                  </div>
                </div>

                <div className="trend-stage">
                  <h3>Fleet Free-Space Timeline</h3>
                  <p>Runtime memory of drive reserve levels captured every five seconds.</p>
                  <TrendChart drives={drives} history={history} />
                </div>
              </div>

              <div className="data-row">
                <div className="subpanel">
                  <h3>Root Density Map</h3>
                  <p>Largest top-level surfaces inside the selected drive.</p>
                  <EntryBars entries={activeDrive.topEntries.slice(0, 8)} totalBytes={activeDrive.totalBytes} />
                </div>

                <div className="subpanel">
                  <h3>Focus Directories</h3>
                  <p>One layer deeper into the heaviest areas.</p>
                  <FocusDirectoryList groups={activeDrive.focusDirectories.slice(0, 4)} />
                </div>
              </div>

              <div className="data-row">
                <div className="subpanel">
                  <h3>Drive Guidance</h3>
                  <p>Action framing that adapts to the selected drive state.</p>
                  <GuidanceDeck items={driveGuidance} />
                </div>

                <div className="subpanel">
                  <h3>Drive Opportunity Queue</h3>
                  <p>Targets detected inside the selected drive.</p>
                  <OpportunityList items={activeDrive.opportunities.slice(0, 4)} />
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel panel-stack panel-right">
          <PanelHeader
            eyebrow="Topology Signals"
            title="Cross-Drive Structure"
            detail="Duplicate roots and standardization patterns."
          />
          <DuplicateList items={duplicates.slice(0, 6)} />
          <div className="divider" />
          <StandardList items={standards} />
        </section>

        <section className="panel panel-bottom-left">
          <PanelHeader
            eyebrow="Visible Artifacts"
            title="Large Files in Current View"
            detail="Root and focus-directory files surfaced by the latest scan."
          />
          <FileList items={activeDrive?.notableFiles ?? []} />
        </section>

        <section className="panel panel-bottom-right">
          <PanelHeader
            eyebrow="System Relay"
            title="Runtime State"
            detail="Live service conditions for the local monitoring stack."
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
    return <EmptyState label="No cleanup signals yet. Initial analysis is still warming up." />
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
    return <EmptyState label="Waiting for directory spectrum..." />
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
    return <EmptyState label="Focus layers will appear after the first deep scan." />
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
    return <EmptyState label="No cross-drive duplicates detected yet." />
  }

  return (
    <div className="stack-list compact">
      {items.map((item) => (
        <article key={item.name} className="signal-item">
          <div className="signal-item__head">
            <strong>{item.name}</strong>
            <small>{item.drives.join(' · ')}</small>
          </div>
          <p>{shortPath(item.paths.join(' | '))}</p>
          <div className="signal-item__foot">
            <span>Combined footprint</span>
            <b>{formatBytes(item.combinedBytes)}</b>
          </div>
        </article>
      ))}
    </div>
  )
}

function StandardList({ items }: { items: StandardizationSuggestion[] }) {
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
    return <EmptyState label="No large file artifacts surfaced yet." />
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
      <StatLine label="Host" value={snapshot.system.hostName} />
      <StatLine label="Platform" value={snapshot.system.platform} />
      <StatLine label="Uptime" value={`${snapshot.system.uptimeMinutes} min`} />
      <StatLine
        label="Active Scan"
        value={snapshot.system.activeScan ? `${snapshot.system.activeScan}:` : 'Idle'}
        tone={snapshot.system.activeScan ? 'warning' : 'stable'}
      />
      <StatLine
        label="Fetch State"
        value={fetchError ? 'Degraded' : 'Nominal'}
        tone={fetchError ? 'critical' : 'stable'}
      />
      <div className="runtime-note">
        {fetchError || 'Data refreshes every five seconds. Deep directory scans rotate in the background.'}
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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fleet free-space timeline">
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
            <span>{formatBytes(drive.freeBytes)} free</span>
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
