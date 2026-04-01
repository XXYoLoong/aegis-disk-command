import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
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
  SettingsView,
  StatusBadge,
} from './components/CockpitViews'
import { t } from './i18n'
import { formatBytes, formatPercent, formatUpdatedAt } from './lib/format'
import type {
  ClientSettings,
  DriveHistoryMap,
  DriveSnapshot,
  LanguageMode,
  Snapshot,
  UiThemeMode,
} from './types'

type ViewMode = 'overview' | 'drive' | 'scan' | 'ai' | 'chat' | 'settings'

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

function hasLiveActivity(snapshot: Snapshot | null) {
  if (!snapshot) return true
  return Boolean(
    snapshot.system.activeScan ||
      snapshot.system.activeAi ||
      snapshot.drives.some((drive) => drive.scanStatus === 'scanning' || drive.aiStatus === 'analyzing'),
  )
}

function resolveTheme(mode: UiThemeMode) {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

function driveCardStyle(usePercent: number): CSSProperties {
  const safePercent = Number.isFinite(usePercent) ? usePercent : 0
  return {
    '--fill-width': `${Math.max(6, Math.min(100, safePercent))}%`,
  } as CSSProperties
}

function mapHealthTone(health: DriveSnapshot['health']) {
  if (health === 'critical') return 'critical'
  if (health === 'warning') return 'warning'
  return 'stable'
}

function mapHealthLabel(health: DriveSnapshot['health'], language: LanguageMode) {
  if (health === 'critical') return t(language, 'healthCritical')
  if (health === 'warning') return t(language, 'healthWarning')
  return t(language, 'healthStable')
}

function mapSystemAiStatus(status: string, language: LanguageMode) {
  if (status === 'disabled') return t(language, 'aiDisabled')
  if (status === 'running' || status === 'analyzing') return t(language, 'aiRunning')
  if (status === 'queued') return t(language, 'aiQueued')
  if (status === 'ready') return t(language, 'aiReady')
  if (status === 'error' || status === 'degraded' || status === 'degraded-cache') return t(language, 'aiError')
  return t(language, 'aiIdle')
}

function createEmptySettings(): ClientSettings {
  return {
    ui: {
      themeMode: 'system',
      language: 'zh-CN',
      reportStyle: 'default',
    },
    runtime: {
      selectedProvider: 'deepseek',
      allowOfflineCache: true,
      autoSaveOnlineCache: true,
    },
    providers: {},
    localPaths: {
      root: '',
      settingsPath: '',
      secretsPath: '',
      cachePath: '',
    },
    setupRequired: true,
    cachedAt: null,
  }
}

function snapshotErrorMessage(language: LanguageMode) {
  return language === 'en-US' ? 'Failed to fetch snapshot.' : '读取快照失败。'
}

function rescanErrorMessage(language: LanguageMode) {
  return language === 'en-US' ? 'Failed to rescan.' : '重新扫描失败。'
}

function chatErrorMessage(language: LanguageMode) {
  return language === 'en-US' ? 'AI chat failed.' : 'AI 对话失败。'
}

function saveSettingsErrorMessage(language: LanguageMode) {
  return language === 'en-US' ? 'Failed to save settings.' : '保存设置失败。'
}

async function fetchSnapshotPayload(language: LanguageMode) {
  const response = await fetch('/api/snapshot')
  if (!response.ok) {
    throw new Error(snapshotErrorMessage(language))
  }
  return (await response.json()) as Snapshot
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
  const [settingsDraft, setSettingsDraft] = useState<ClientSettings>(createEmptySettings())
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({})
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const deferredSnapshot = useDeferredValue(snapshot)

  const language = settingsDraft.ui.language

  function markDirty() {
    setSettingsDirty(true)
    setSettingsMessage('')
    setSettingsError('')
  }

  const refreshSnapshot = useEffectEvent(async () => {
    try {
      const nextSnapshot = await fetchSnapshotPayload(language)

      startTransition(() => {
        setSnapshot(nextSnapshot)
        setHistory((previous) => appendHistory(previous, nextSnapshot))
      })

      setSettingsDraft((previous) => {
        if (settingsDirty && Object.keys(previous.providers).length > 0) {
          return previous
        }

        return nextSnapshot.settings
      })

      setFetchError('')
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : snapshotErrorMessage(language))
    }
  })

  useEffect(() => {
    void refreshSnapshot()
  }, [])

  useEffect(() => {
    const intervalMs = hasLiveActivity(snapshot) ? 1200 : 4200
    const timer = window.setInterval(() => {
      void refreshSnapshot()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [snapshot, settingsDirty])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolveTheme(settingsDraft.ui.themeMode)
    }

    applyTheme()

    if (settingsDraft.ui.themeMode === 'system') {
      media.addEventListener('change', applyTheme)
      return () => media.removeEventListener('change', applyTheme)
    }

    return undefined
  }, [settingsDraft.ui.themeMode])

  useEffect(() => {
    if (!snapshot?.drives.length) return
    if (!selectedDrive || !snapshot.drives.some((drive) => drive.letter === selectedDrive)) {
      setSelectedDrive(pickDefaultDrive(snapshot.drives))
    }
  }, [selectedDrive, snapshot])

  const views = useMemo(
    () => [
      { id: 'overview', label: t(language, 'viewOverview') },
      { id: 'drive', label: t(language, 'viewDrive') },
      { id: 'scan', label: t(language, 'viewScan') },
      { id: 'ai', label: t(language, 'viewAi') },
      { id: 'chat', label: t(language, 'viewChat') },
      { id: 'settings', label: t(language, 'viewSettings') },
    ],
    [language],
  )

  async function queueRescan(letter: string) {
    setRescanTarget(letter)
    try {
      const response = await fetch('/api/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drive: letter }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data?.message ?? rescanErrorMessage(language))
      }
      setViewMode('scan')
      setFetchError('')
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : rescanErrorMessage(language))
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
        throw new Error(data?.message ?? chatErrorMessage(language))
      }
      setChatByDrive((previous) => ({
        ...previous,
        [selectedDrive]: [...(previous[selectedDrive] ?? []), { role: 'assistant', content: String(data.reply ?? '') }],
      }))
    } catch (error) {
      setChatError(error instanceof Error ? error.message : chatErrorMessage(language))
    } finally {
      setChatBusy(false)
    }
  }

  async function saveSettings() {
    setSettingsBusy(true)
    setSettingsError('')
    setSettingsMessage('')

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ui: settingsDraft.ui,
          runtime: settingsDraft.runtime,
          providers: Object.fromEntries(
            Object.entries(settingsDraft.providers).map(([providerId, config]) => [
              providerId,
              {
                baseUrl: config.baseUrl,
                model: config.model,
                timeoutMs: config.timeoutMs,
              },
            ]),
          ),
          providerSecrets: Object.fromEntries(
            Object.entries(providerApiKeys).filter(([, value]) => value.trim()),
          ),
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data?.message ?? saveSettingsErrorMessage(language))
      }

      setSettingsDraft(data.settings)
      setProviderApiKeys({})
      setSettingsDirty(false)
      setSettingsMessage(language === 'en-US' ? 'Settings saved.' : '设置已保存。')

      const nextSnapshot = await fetchSnapshotPayload(data.settings.ui.language)
      startTransition(() => {
        setSnapshot(nextSnapshot)
        setHistory((previous) => appendHistory(previous, nextSnapshot))
      })
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : saveSettingsErrorMessage(language))
    } finally {
      setSettingsBusy(false)
    }
  }

  function updateUiSetting<Key extends keyof ClientSettings['ui']>(
    key: Key,
    value: ClientSettings['ui'][Key],
  ) {
    setSettingsDraft((previous) => ({
      ...previous,
      ui: { ...previous.ui, [key]: value },
    }))
    markDirty()
  }

  function updateRuntimeSetting<Key extends keyof ClientSettings['runtime']>(
    key: Key,
    value: ClientSettings['runtime'][Key],
  ) {
    setSettingsDraft((previous) => ({
      ...previous,
      runtime: { ...previous.runtime, [key]: value },
    }))
    markDirty()
  }

  function updateProviderField(
    providerId: string,
    field: 'baseUrl' | 'model' | 'timeoutMs',
    value: string,
  ) {
    setSettingsDraft((previous) => {
      const current = previous.providers[providerId]
      if (!current) return previous

      return {
        ...previous,
        providers: {
          ...previous.providers,
          [providerId]: {
            ...current,
            [field]: field === 'timeoutMs' ? Number(value || 0) : value,
          },
        },
      }
    })
    markDirty()
  }

  function updateProviderApiKey(providerId: string, value: string) {
    setProviderApiKeys((previous) => ({ ...previous, [providerId]: value }))
    markDirty()
  }

  if (!deferredSnapshot) {
    return (
      <div className="app-shell">
        <div className="app-backdrop" />
        <main className="boot-screen">
          <div className="boot-ring" />
          <p>{language === 'en-US' ? 'Starting the local disk cockpit...' : '正在启动本地磁盘治理中枢...'}</p>
        </main>
      </div>
    )
  }

  const activeDrive =
    deferredSnapshot.drives.find((drive) => drive.letter === selectedDrive) ??
    deferredSnapshot.drives[0] ??
    null
  const chatMessages = activeDrive ? chatByDrive[activeDrive.letter] ?? [] : []

  const selectedProviderConfig = settingsDraft.providers[deferredSnapshot.system.selectedProvider]
  const providerDisplayName = selectedProviderConfig
    ? language === 'en-US'
      ? selectedProviderConfig.names.en
      : selectedProviderConfig.names.zh
    : deferredSnapshot.system.aiProvider || '--'

  return (
    <div className="app-shell">
      <div className="app-backdrop" />

      <header className="top-shell">
        <div className="brand-block">
          <p className="caption">{t(language, 'topCaption')}</p>
          <h1>{t(language, 'appName')}</h1>
          <p className="subcopy">{t(language, 'appSubtitle')}</p>
        </div>

        <div className="top-metrics">
          <MetricChip label={t(language, 'totalCapacity')} value={formatBytes(deferredSnapshot.system.totalBytes, language)} />
          <MetricChip label={t(language, 'freeSpace')} value={formatBytes(deferredSnapshot.system.freeBytes, language)} />
          <MetricChip label={t(language, 'scanQueue')} value={String(deferredSnapshot.system.scanQueueDepth)} />
          <MetricChip label={t(language, 'aiQueue')} value={String(deferredSnapshot.system.aiQueueDepth)} />
          <MetricChip label={t(language, 'provider')} value={providerDisplayName} />
          <MetricChip label={t(language, 'host')} value={deferredSnapshot.system.hostName} />
        </div>

        <nav className="top-nav">
          {views.map((view) => (
            <button
              key={view.id}
              className={`nav-pill ${viewMode === view.id ? 'is-active' : ''}`}
              onClick={() => setViewMode(view.id as ViewMode)}
            >
              {view.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="workspace">
        <aside className="drive-rail">
          <div className="rail-head">
            <strong>{t(language, 'drivesRail')}</strong>
            <StatusBadge tone={deferredSnapshot.system.setupRequired ? 'warning' : 'stable'}>
              {deferredSnapshot.system.setupRequired ? t(language, 'setupRequired') : mapHealthLabel('stable', language)}
            </StatusBadge>
          </div>

          <div className="drive-stack">
            {deferredSnapshot.drives.map((drive) => (
              <button
                key={drive.letter}
                className={`drive-card ${selectedDrive === drive.letter ? 'is-selected' : ''}`}
                onClick={() => setSelectedDrive(drive.letter)}
                style={driveCardStyle(drive.usePercent)}
              >
                <div className="drive-card__head">
                  <strong>{drive.letter}:</strong>
                  <StatusBadge tone={mapHealthTone(drive.health)}>{mapHealthLabel(drive.health, language)}</StatusBadge>
                </div>
                <div className="drive-card__meta">
                  <span>{drive.fsType}</span>
                  <span>{formatPercent(drive.usePercent, language)}</span>
                </div>
                <div className="drive-card__bar">
                  <span />
                </div>
                <small>{formatBytes(drive.freeBytes, language)}</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="main-stage">
          {viewMode === 'overview' ? (
            <OverviewView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              language={language}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'drive' ? (
            <DriveView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              language={language}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'scan' ? (
            <ScanView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              language={language}
              onRescan={queueRescan}
              rescanTarget={rescanTarget}
            />
          ) : null}

          {viewMode === 'ai' ? (
            <AiView
              snapshot={deferredSnapshot}
              activeDrive={activeDrive}
              history={history}
              language={language}
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
              language={language}
              onDraftChange={setChatDraft}
              onSubmit={submitChat}
            />
          ) : null}

          {viewMode === 'settings' ? (
            <SettingsView
              language={language}
              settings={settingsDraft}
              providerApiKeys={providerApiKeys}
              saveBusy={settingsBusy}
              saveError={settingsError}
              saveMessage={settingsMessage}
              onThemeChange={(value) => updateUiSetting('themeMode', value)}
              onLanguageChange={(value) => updateUiSetting('language', value)}
              onReportStyleChange={(value) => updateUiSetting('reportStyle', value)}
              onProviderChange={(value) => updateRuntimeSetting('selectedProvider', value)}
              onProviderFieldChange={updateProviderField}
              onProviderApiKeyChange={updateProviderApiKey}
              onToggleRuntime={(field, value) => updateRuntimeSetting(field, value)}
              onSave={saveSettings}
            />
          ) : null}
        </main>

        <aside className="side-panel">
          <section className="side-card">
            <div className="side-card__head">
              <strong>{t(language, 'systemStatus')}</strong>
              <StatusBadge tone={fetchError ? 'critical' : deferredSnapshot.system.setupRequired ? 'warning' : 'stable'}>
                {fetchError
                  ? t(language, 'scanError')
                  : deferredSnapshot.system.setupRequired
                    ? t(language, 'scanQueued')
                    : t(language, 'scanReady')}
              </StatusBadge>
            </div>
            <div className="side-metrics">
              <MetricChip label={t(language, 'provider')} value={providerDisplayName} />
              <MetricChip label={t(language, 'aiStatusLabel')} value={mapSystemAiStatus(deferredSnapshot.system.aiStatus, language)} />
              <MetricChip label={t(language, 'lastUpdated')} value={formatUpdatedAt(deferredSnapshot.generatedAt, language)} />
            </div>
            {fetchError ? <p className="inline-error">{fetchError}</p> : null}
          </section>

          <section className="side-card">
            <div className="side-card__head">
              <strong>{t(language, 'currentDrive')}</strong>
            </div>
            {activeDrive ? (
              <>
                <p className="side-copy">{activeDrive.analysisSummary || t(language, 'noData')}</p>
                <div className="side-metrics">
                  <MetricChip label={t(language, 'freeSpace')} value={formatBytes(activeDrive.freeBytes, language)} />
                  <MetricChip label={t(language, 'lastUpdated')} value={formatUpdatedAt(activeDrive.lastScannedAt, language)} />
                </div>
              </>
            ) : (
              <EmptyState language={language} title={t(language, 'noDrive')} detail={t(language, 'noData')} />
            )}
          </section>

          <section className="side-card">
            <div className="side-card__head">
              <strong>{t(language, 'standards')}</strong>
            </div>
            <p className="side-copy">{deferredSnapshot.crossDrive.summary || t(language, 'noSuggestions')}</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
