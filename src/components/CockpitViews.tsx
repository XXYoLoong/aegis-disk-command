import type { CSSProperties, ReactNode } from 'react'
import { describeReportStyle, t } from '../i18n'
import {
  formatBytes,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatUpdatedAt,
  shortPath,
} from '../lib/format'
import type {
  ClientSettings,
  DriveHistoryMap,
  DriveSnapshot,
  DuplicateNameGroup,
  LanguageMode,
  Opportunity,
  Snapshot,
  StandardizationSuggestion,
} from '../types'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ViewCommonProps {
  snapshot: Snapshot
  activeDrive: DriveSnapshot | null
  history: DriveHistoryMap
  language: LanguageMode
  rescanTarget: string
  onRescan: (letter: string) => void
}

interface ChatViewProps {
  drive: DriveSnapshot | null
  draft: string
  busy: boolean
  error: string
  messages: ChatMessage[]
  language: LanguageMode
  onDraftChange: (value: string) => void
  onSubmit: () => void
}

interface SettingsViewProps {
  language: LanguageMode
  settings: ClientSettings
  providerApiKeys: Record<string, string>
  saveBusy: boolean
  saveError: string
  saveMessage: string
  onThemeChange: (value: ClientSettings['ui']['themeMode']) => void
  onLanguageChange: (value: LanguageMode) => void
  onReportStyleChange: (value: ClientSettings['ui']['reportStyle']) => void
  onProviderChange: (value: string) => void
  onProviderFieldChange: (providerId: string, field: 'baseUrl' | 'model' | 'timeoutMs', value: string) => void
  onProviderApiKeyChange: (providerId: string, value: string) => void
  onToggleRuntime: (field: 'allowOfflineCache' | 'autoSaveOnlineCache', value: boolean) => void
  onSave: () => void
}

export function OverviewView({
  snapshot,
  activeDrive,
  history,
  language,
  rescanTarget,
  onRescan,
}: ViewCommonProps) {
  const providerConfig = snapshot.settings.providers[snapshot.system.selectedProvider]
  const providerName = providerConfig
    ? language === 'en-US'
      ? providerConfig.names.en
      : providerConfig.names.zh
    : snapshot.system.aiProvider || '--'

  return (
    <div className="view-grid view-overview">
      <Panel
        eyebrow={t(language, 'overviewHeadline')}
        title={activeDrive ? `${activeDrive.letter}: ${t(language, 'currentDrive')}` : t(language, 'currentDrive')}
        detail={t(language, 'overviewDetail')}
        action={
          activeDrive ? (
            <button
              className="ghost-button"
              disabled={rescanTarget === activeDrive.letter}
              onClick={() => onRescan(activeDrive.letter)}
            >
              {rescanTarget === activeDrive.letter ? t(language, 'queued') : t(language, 'rescan')}
            </button>
          ) : null
        }
      >
        {activeDrive ? (
          <div className="hero-grid">
            <div className="hero-spotlight">
              <UsageDial drive={activeDrive} language={language} />
              <div className="hero-copy">
                <h3>{activeDrive.analysisSummary || t(language, 'noData')}</h3>
                <div className="metric-grid">
                  <MetricChip label={t(language, 'aiStatusLabel')} value={labelAiStatus(activeDrive.aiStatus, language)} />
                  <MetricChip label={t(language, 'scanElapsed')} value={formatDurationMs(activeDrive.scanDurationMs, language)} />
                  <MetricChip label={t(language, 'provider')} value={providerName} />
                  <MetricChip label={t(language, 'freeSpace')} value={formatBytes(activeDrive.freeBytes, language)} />
                </div>
              </div>
            </div>
            <PanelBlock
              title={t(language, 'opportunities')}
              detail={snapshot.crossDrive.summary || t(language, 'noSuggestions')}
            >
              <OpportunityList items={snapshot.crossDrive.topOpportunities.slice(0, 4)} language={language} />
            </PanelBlock>
          </div>
        ) : (
          <EmptyState language={language} title={t(language, 'noDrive')} detail={t(language, 'noData')} />
        )}
      </Panel>

      <Panel eyebrow={t(language, 'duplicates')} title={t(language, 'duplicates')} detail={snapshot.crossDrive.summary || t(language, 'noSuggestions')}>
        <DuplicateList items={snapshot.crossDrive.duplicateTopLevelNames.slice(0, 8)} language={language} />
      </Panel>

      <Panel
        eyebrow={t(language, 'standards')}
        title={t(language, 'standards')}
        detail={describeReportStyle(language, snapshot.settings.ui.reportStyle)}
      >
        <StandardList items={snapshot.crossDrive.standardizationSuggestions.slice(0, 8)} language={language} />
      </Panel>

      <Panel eyebrow={t(language, 'lastUpdated')} title={t(language, 'overviewHeadline')} detail={formatUpdatedAt(snapshot.generatedAt, language)}>
        {activeDrive ? (
          <TrendChart points={history[activeDrive.letter] ?? []} language={language} />
        ) : (
          <EmptyState language={language} title={t(language, 'noData')} detail={t(language, 'noDrive')} />
        )}
      </Panel>
    </div>
  )
}

export function DriveView({ activeDrive, language, rescanTarget, onRescan }: ViewCommonProps) {
  if (!activeDrive) {
    return <EmptyState language={language} title={t(language, 'noDrive')} detail={t(language, 'driveDetail')} />
  }

  return (
    <div className="view-grid view-drive">
      <Panel
        eyebrow={t(language, 'topEntries')}
        title={`${activeDrive.letter}: ${t(language, 'topEntries')}`}
        detail={t(language, 'driveDetail')}
        action={
          <button
            className="ghost-button"
            disabled={rescanTarget === activeDrive.letter}
            onClick={() => onRescan(activeDrive.letter)}
          >
            {rescanTarget === activeDrive.letter ? t(language, 'queued') : t(language, 'rescan')}
          </button>
        }
      >
        <EntryBars items={activeDrive.topEntries} language={language} emptyText={t(language, 'noData')} />
      </Panel>

      <Panel eyebrow={t(language, 'focusAreas')} title={t(language, 'focusAreas')} detail={t(language, 'driveDetail')}>
        <FocusDirectoryList directories={activeDrive.focusDirectories} language={language} />
      </Panel>

      <Panel eyebrow={t(language, 'notableFiles')} title={t(language, 'notableFiles')} detail={t(language, 'driveDetail')}>
        <FileList files={activeDrive.notableFiles} language={language} />
      </Panel>
    </div>
  )
}

export function ScanView({ snapshot, activeDrive, language }: ViewCommonProps) {
  const liveDrive = snapshot.drives.find((drive) => drive.scanStatus === 'scanning') ?? activeDrive
  const progress = liveDrive?.scanProgress ?? null

  return (
    <div className="view-grid view-scan">
      <Panel eyebrow={t(language, 'scanHeadline')} title={t(language, 'scanHeadline')} detail={t(language, 'scanDetail')}>
        {liveDrive && progress ? (
          <div className="scan-stage">
            <div className="scan-stage__title">
              <strong>{liveDrive.letter}:</strong>
              <StatusBadge tone={scanTone(liveDrive.scanStatus)}>{labelScanStatus(liveDrive.scanStatus, language)}</StatusBadge>
            </div>
            <ProgressStrip percent={progress.percent} language={language} />
            <div className="metric-grid">
              <MetricChip label={t(language, 'scanStage')} value={progress.phase || '--'} />
              <MetricChip label={t(language, 'scanRoots')} value={`${progress.rootsCompleted}/${progress.rootsTotal}`} />
              <MetricChip label={t(language, 'scanFiles')} value={formatNumber(progress.filesVisited, language)} />
              <MetricChip label={t(language, 'scanDirs')} value={formatNumber(progress.directoriesVisited, language)} />
              <MetricChip label={t(language, 'scanBytes')} value={formatBytes(progress.bytesSeen, language)} />
              <MetricChip label={t(language, 'scanElapsed')} value={formatDurationMs(progress.elapsedMs, language)} />
            </div>
            <PathLine label={t(language, 'currentRoot')} value={progress.currentRoot ?? '--'} />
            <PathLine label={t(language, 'currentPath')} value={progress.currentPath ?? '--'} />
          </div>
        ) : (
          <EmptyState language={language} title={t(language, 'scanHeadline')} detail={t(language, 'noData')} />
        )}
      </Panel>

      <Panel eyebrow={t(language, 'drivesRail')} title={t(language, 'drivesRail')} detail={t(language, 'scanDetail')}>
        <DriveStatusBoard drives={snapshot.drives} language={language} />
      </Panel>
    </div>
  )
}

export function AiView({ snapshot, activeDrive, language }: ViewCommonProps) {
  const providerConfig = snapshot.settings.providers[snapshot.system.selectedProvider]
  const providerName = providerConfig
    ? language === 'en-US'
      ? providerConfig.names.en
      : providerConfig.names.zh
    : snapshot.system.aiProvider || t(language, 'provider')

  return (
    <div className="view-grid view-ai">
      <Panel eyebrow={t(language, 'aiHeadline')} title={t(language, 'aiHeadline')} detail={t(language, 'aiDetail')}>
        {activeDrive ? (
          <>
            <div className="summary-box">
              <StatusBadge tone={aiTone(activeDrive.aiStatus)}>{labelAiStatus(activeDrive.aiStatus, language)}</StatusBadge>
              <p>{activeDrive.analysisSummary || t(language, 'noSuggestions')}</p>
            </div>
            <GuidanceList items={activeDrive.aiGuidance} language={language} />
          </>
        ) : (
          <EmptyState language={language} title={t(language, 'noDrive')} detail={t(language, 'aiDetail')} />
        )}
      </Panel>

      <Panel eyebrow={t(language, 'provider')} title={providerName} detail={snapshot.system.analysisEngine}>
        <div className="metric-grid">
          <MetricChip label={t(language, 'provider')} value={providerName} />
          <MetricChip label={t(language, 'providerModel')} value={snapshot.system.aiModel || '--'} />
          <MetricChip label={t(language, 'aiStatusLabel')} value={labelAiStatus(snapshot.system.aiStatus, language)} />
          <MetricChip label={t(language, 'lastUpdated')} value={formatUpdatedAt(snapshot.system.aiLastAnalyzedAt, language)} />
        </div>
      </Panel>
    </div>
  )
}

export function ChatView({
  drive,
  draft,
  busy,
  error,
  messages,
  language,
  onDraftChange,
  onSubmit,
}: ChatViewProps) {
  return (
    <div className="view-grid view-chat">
      <Panel eyebrow={t(language, 'chatHeadline')} title={drive ? `${drive.letter}: ${t(language, 'chatHeadline')}` : t(language, 'chatHeadline')} detail={t(language, 'chatDetail')}>
        <div className="chat-shell">
          <div className="chat-log">
            {messages.length ? (
              messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`chat-bubble chat-${message.role}`}>
                  <strong>{message.role === 'assistant' ? 'AI' : language === 'en-US' ? 'You' : '你'}</strong>
                  <p>{message.content}</p>
                </article>
              ))
            ) : (
              <EmptyState language={language} title={t(language, 'noChat')} detail={t(language, 'chatDetail')} />
            )}
          </div>
          <textarea
            className="chat-input"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={t(language, 'chatPlaceholder')}
            rows={5}
          />
          <div className="chat-actions">
            <span>{drive?.analysisSource === 'offline-cache' ? t(language, 'useCached') : t(language, 'chatDetail')}</span>
            <button className="primary-button" disabled={busy || !draft.trim() || drive?.scanStatus !== 'ready'} onClick={onSubmit}>
              {busy ? t(language, 'thinking') : t(language, 'sendQuestion')}
            </button>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      </Panel>
    </div>
  )
}

export function SettingsView(props: SettingsViewProps) {
  const providerList = Object.values(props.settings.providers)
  const selected =
    props.settings.providers[props.settings.runtime.selectedProvider] ??
    providerList[0]

  if (!selected) {
    return (
      <div className="view-grid view-settings">
        <Panel eyebrow={t(props.language, 'settingsHeadline')} title={t(props.language, 'settingsHeadline')} detail={t(props.language, 'settingsDetail')}>
          <EmptyState
            language={props.language}
            title={t(props.language, 'settingsHeadline')}
            detail={t(props.language, 'setupRequired')}
          />
        </Panel>
      </div>
    )
  }

  return (
    <div className="view-grid view-settings">
      <Panel eyebrow={t(props.language, 'settingsHeadline')} title={t(props.language, 'settingsHeadline')} detail={t(props.language, 'settingsDetail')}>
        <div className="settings-grid">
          <SettingGroup title={t(props.language, 'themeLabel')}>
            <SegmentedPicker
              value={props.settings.ui.themeMode}
              onChange={(value) => props.onThemeChange(value as ClientSettings['ui']['themeMode'])}
              options={[
                { id: 'system', label: t(props.language, 'themeSystem') },
                { id: 'dark', label: t(props.language, 'themeDark') },
                { id: 'light', label: t(props.language, 'themeLight') },
              ]}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'languageLabel')}>
            <SegmentedPicker
              value={props.settings.ui.language}
              onChange={(value) => props.onLanguageChange(value as LanguageMode)}
              options={[
                { id: 'zh-CN', label: '中文' },
                { id: 'en-US', label: props.language === 'en-US' ? 'English' : '英文' },
              ]}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'reportStyleLabel')}>
            <SegmentedPicker
              value={props.settings.ui.reportStyle}
              onChange={(value) => props.onReportStyleChange(value as ClientSettings['ui']['reportStyle'])}
              options={[
                { id: 'default', label: t(props.language, 'styleDefault') },
                { id: 'gov-report', label: t(props.language, 'styleGov') },
              ]}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'providerLabel')}>
            <select
              className="field"
              value={props.settings.runtime.selectedProvider}
              onChange={(event) => props.onProviderChange(event.target.value)}
            >
              {providerList.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {props.language === 'en-US' ? provider.names.en : provider.names.zh}
                </option>
              ))}
            </select>
            <p className="field-hint">
              {props.language === 'en-US' ? selected.description.en : selected.description.zh}
            </p>
          </SettingGroup>

          <SettingGroup title={t(props.language, 'providerBaseUrl')}>
            <input
              className="field"
              value={selected.baseUrl}
              onChange={(event) => props.onProviderFieldChange(selected.id, 'baseUrl', event.target.value)}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'providerModel')}>
            <input
              className="field"
              value={selected.model}
              onChange={(event) => props.onProviderFieldChange(selected.id, 'model', event.target.value)}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'providerTimeout')}>
            <input
              className="field"
              value={String(selected.timeoutMs)}
              onChange={(event) => props.onProviderFieldChange(selected.id, 'timeoutMs', event.target.value)}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'providerApiKey')}>
            <input
              className="field"
              type="password"
              placeholder={selected.apiKeySet ? selected.apiKeyPreview : ''}
              value={props.providerApiKeys[selected.id] ?? ''}
              onChange={(event) => props.onProviderApiKeyChange(selected.id, event.target.value)}
            />
            <p className="field-hint">{t(props.language, 'providerApiKeyHint')}</p>
          </SettingGroup>

          <SettingGroup title={t(props.language, 'offlineCache')}>
            <ToggleRow
              checked={props.settings.runtime.allowOfflineCache}
              onChange={(value) => props.onToggleRuntime('allowOfflineCache', value)}
            />
          </SettingGroup>

          <SettingGroup title={t(props.language, 'autoSaveCache')}>
            <ToggleRow
              checked={props.settings.runtime.autoSaveOnlineCache}
              onChange={(value) => props.onToggleRuntime('autoSaveOnlineCache', value)}
            />
          </SettingGroup>
        </div>

        <div className="settings-footer">
          <div className="settings-notes">
            {props.settings.setupRequired ? <p>{t(props.language, 'setupRequired')}</p> : null}
            <p>{`${t(props.language, 'cachedAt')}: ${props.settings.cachedAt ? formatUpdatedAt(props.settings.cachedAt, props.language) : t(props.language, 'notCached')}`}</p>
          </div>
          <button className="primary-button" disabled={props.saveBusy} onClick={props.onSave}>
            {props.saveBusy ? t(props.language, 'thinking') : t(props.language, 'saveSettings')}
          </button>
        </div>

        {props.saveMessage ? <p className="inline-success">{props.saveMessage}</p> : null}
        {props.saveError ? <p className="inline-error">{props.saveError}</p> : null}
      </Panel>

      <Panel eyebrow={t(props.language, 'localFiles')} title={t(props.language, 'localFiles')} detail={t(props.language, 'useCached')}>
        <div className="stack-list">
          <PathCard label={t(props.language, 'localSettingsPath')} value={props.settings.localPaths.settingsPath} />
          <PathCard label={t(props.language, 'localSecretsPath')} value={props.settings.localPaths.secretsPath} />
          <PathCard label={t(props.language, 'localCachePath')} value={props.settings.localPaths.cachePath} />
        </div>
      </Panel>
    </div>
  )
}

export function Panel(props: {
  eyebrow: string
  title: string
  detail: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <p className="panel-eyebrow">{props.eyebrow}</p>
          <h2>{props.title}</h2>
          <p className="panel-detail">{props.detail}</p>
        </div>
        {props.action}
      </header>
      <div className="panel-body">{props.children}</div>
    </section>
  )
}

export function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: 'critical' | 'warning' | 'stable' | 'info'
  children: ReactNode
}) {
  return <span className={`status-badge tone-${tone}`}>{children}</span>
}

export function EmptyState({
  title,
  detail,
}: {
  language: LanguageMode
  title: string
  detail: string
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

function PanelBlock({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <article className="panel-block">
      <div className="panel-block__head">
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <div>{children}</div>
    </article>
  )
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="setting-group">
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  )
}

function SegmentedPicker(props: {
  value: string
  onChange: (value: string) => void
  options: Array<{ id: string; label: string }>
}) {
  return (
    <div className="segmented-picker">
      {props.options.map((option) => (
        <button
          key={option.id}
          className={`segment ${props.value === option.id ? 'is-active' : ''}`}
          onClick={() => props.onChange(option.id)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function ToggleRow({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button className={`toggle ${checked ? 'is-active' : ''}`} onClick={() => onChange(!checked)} type="button">
      <span />
    </button>
  )
}

function PathCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stack-card">
      <strong>{label}</strong>
      <code>{shortPath(value)}</code>
    </article>
  )
}

function UsageDial({ drive, language }: { drive: DriveSnapshot; language: LanguageMode }) {
  const safePercent = Number.isFinite(drive.usePercent) ? drive.usePercent : 0
  const style = {
    '--usage-angle': `${Math.max(8, Math.min(100, safePercent)) * 3.6}deg`,
  } as CSSProperties

  return (
    <div className="usage-dial" style={style}>
      <div className="usage-dial__inner">
        <span>{drive.letter}:</span>
        <strong>{formatPercent(safePercent, language)}</strong>
        <small>{formatBytes(drive.freeBytes, language)}</small>
      </div>
    </div>
  )
}

function TrendChart({
  points,
  language,
}: {
  points: DriveHistoryMap[string] | undefined
  language: LanguageMode
}) {
  if (!points?.length) {
    return <EmptyState language={language} title={t(language, 'noData')} detail={t(language, 'overviewDetail')} />
  }

  const width = 420
  const height = 160
  const values = points
    .map((point) => (Number.isFinite(point.usedPercent) ? point.usedPercent : 0))
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const path = points
    .map((point, index) => {
      const usedPercent = Number.isFinite(point.usedPercent) ? point.usedPercent : 0
      const x = (index / Math.max(points.length - 1, 1)) * width
      const y = height - ((usedPercent - min) / range) * (height - 24) - 12
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path className="trend-axis" d={`M 0 ${height - 1} L ${width} ${height - 1}`} />
      <path className="trend-line" d={path} />
    </svg>
  )
}

function ProgressStrip({ percent, language }: { percent: number; language: LanguageMode }) {
  const safePercent = Number.isFinite(percent) ? percent : 0
  return (
    <div className="progress-strip">
      <div className="progress-strip__bar" style={{ width: `${Math.max(4, Math.min(100, safePercent))}%` }} />
      <span>{formatPercent(safePercent, language)}</span>
    </div>
  )
}

function OpportunityList({ items, language }: { items: Opportunity[]; language: LanguageMode }) {
  if (!items.length) {
    return <EmptyState language={language} title={t(language, 'noOpportunities')} detail={t(language, 'overviewDetail')} />
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <article key={item.id} className="stack-card">
          <div className="stack-head">
            <StatusBadge tone={severityTone(item.severity)}>{item.severity}</StatusBadge>
            <span>{formatBytes(item.estimatedBytes, language)}</span>
          </div>
          <strong>{item.title}</strong>
          <p>{item.action}</p>
          <code>{shortPath(item.path)}</code>
        </article>
      ))}
    </div>
  )
}

function DuplicateList({ items, language }: { items: DuplicateNameGroup[]; language: LanguageMode }) {
  if (!items.length) {
    return <EmptyState language={language} title={t(language, 'noDuplicates')} detail={t(language, 'duplicates')} />
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <article key={`${item.name}-${item.combinedBytes}`} className="stack-card">
          <div className="stack-head">
            <strong>{item.name}</strong>
            <span>{formatBytes(item.combinedBytes, language)}</span>
          </div>
          <p>{item.drives.join(' / ')}</p>
          <code>{shortPath(item.paths[0] ?? item.name)}</code>
        </article>
      ))}
    </div>
  )
}

function StandardList({ items, language }: { items: StandardizationSuggestion[]; language: LanguageMode }) {
  if (!items.length) {
    return <EmptyState language={language} title={t(language, 'noSuggestions')} detail={t(language, 'standards')} />
  }

  return (
    <div className="stack-list">
      {items.map((item, index) => (
        <article key={`${item.title}-${index}`} className="stack-card">
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  )
}

function EntryBars({
  items,
  language,
  emptyText,
}: {
  items: DriveSnapshot['topEntries']
  language: LanguageMode
  emptyText: string
}) {
  if (!items.length) {
    return <EmptyState language={language} title={t(language, 'noData')} detail={emptyText} />
  }

  const max = Math.max(...items.map((item) => item.sizeBytes), 1)
  return (
    <div className="stack-list">
      {items.map((item) => (
        <article key={item.path} className="bar-card">
          <div className="stack-head">
            <strong>{item.name}</strong>
            <span>{formatBytes(item.sizeBytes, language)}</span>
          </div>
          <div className="bar-track">
            <span style={{ width: `${(item.sizeBytes / max) * 100}%` }} />
          </div>
          <code>{shortPath(item.path)}</code>
        </article>
      ))}
    </div>
  )
}

function FocusDirectoryList({
  directories,
  language,
}: {
  directories: DriveSnapshot['focusDirectories']
  language: LanguageMode
}) {
  if (!directories.length) {
    return <EmptyState language={language} title={t(language, 'noData')} detail={t(language, 'focusAreas')} />
  }

  return (
    <div className="stack-list">
      {directories.map((directory) => (
        <article key={directory.path} className="stack-card">
          <div className="stack-head">
            <strong>{directory.name}</strong>
            <span>{formatBytes(directory.sizeBytes, language)}</span>
          </div>
          <code>{shortPath(directory.path)}</code>
          <div className="sub-list">
            {directory.children.map((child) => (
              <div key={child.path} className="sub-row">
                <span>{child.name}</span>
                <span>{formatBytes(child.sizeBytes, language)}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

function FileList({ files, language }: { files: DriveSnapshot['notableFiles']; language: LanguageMode }) {
  if (!files.length) {
    return <EmptyState language={language} title={t(language, 'noData')} detail={t(language, 'notableFiles')} />
  }

  return (
    <div className="stack-list">
      {files.map((file) => (
        <article key={file.path} className="stack-card">
          <div className="stack-head">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.sizeBytes, language)}</span>
          </div>
          <p>{file.extension || file.type}</p>
          <code>{shortPath(file.path)}</code>
        </article>
      ))}
    </div>
  )
}

function GuidanceList({ items, language }: { items: DriveSnapshot['aiGuidance']; language: LanguageMode }) {
  if (!items.length) {
    return <EmptyState language={language} title={t(language, 'noSuggestions')} detail={t(language, 'aiDetail')} />
  }

  return (
    <div className="stack-list">
      {items.map((item, index) => (
        <article key={`${item.title}-${index}`} className="stack-card">
          <div className="stack-head">
            <StatusBadge tone={guidanceTone(item.tone)}>{item.tone}</StatusBadge>
          </div>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  )
}

function DriveStatusBoard({ drives, language }: { drives: Snapshot['drives']; language: LanguageMode }) {
  return (
    <div className="stack-list">
      {drives.map((drive) => (
        <article key={drive.letter} className="stack-card">
          <div className="stack-head">
            <strong>{drive.letter}:</strong>
            <StatusBadge tone={scanTone(drive.scanStatus)}>{labelScanStatus(drive.scanStatus, language)}</StatusBadge>
          </div>
          <div className="metric-grid compact">
            <MetricChip label={t(language, 'freeSpace')} value={formatBytes(drive.freeBytes, language)} />
            <MetricChip label={t(language, 'aiStatusLabel')} value={labelAiStatus(drive.aiStatus, language)} />
          </div>
        </article>
      ))}
    </div>
  )
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="path-line">
      <span>{label}</span>
      <code>{shortPath(value)}</code>
    </div>
  )
}

function severityTone(severity: string) {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function guidanceTone(tone: string) {
  if (tone === 'critical') return 'critical'
  if (tone === 'warning') return 'warning'
  if (tone === 'stable') return 'stable'
  return 'info'
}

function scanTone(status: string) {
  if (status === 'ready') return 'stable'
  if (status === 'scanning') return 'info'
  if (status === 'error') return 'critical'
  return 'warning'
}

function aiTone(status: string) {
  if (status === 'ready') return 'stable'
  if (status === 'analyzing') return 'info'
  if (status === 'error') return 'critical'
  if (status === 'disabled') return 'warning'
  return 'warning'
}

function labelScanStatus(status: string, language: LanguageMode) {
  if (status === 'ready') return t(language, 'scanReady')
  if (status === 'scanning') return t(language, 'scanRunning')
  if (status === 'error') return t(language, 'scanError')
  return t(language, 'scanQueued')
}

function labelAiStatus(status: string, language: LanguageMode) {
  if (status === 'disabled') return t(language, 'aiDisabled')
  if (status === 'ready') return t(language, 'aiReady')
  if (status === 'analyzing' || status === 'running') return t(language, 'aiRunning')
  if (status === 'error' || status === 'degraded' || status === 'degraded-cache') return t(language, 'aiError')
  if (status === 'queued') return t(language, 'aiQueued')
  return t(language, 'aiIdle')
}
