import type { CSSProperties, ReactNode } from 'react'
import type {
  DriveHistoryMap,
  DriveSnapshot,
  DuplicateNameGroup,
  Opportunity,
  Snapshot,
  StandardizationSuggestion,
} from '../types'
import {
  formatBytes,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatUpdatedAt,
  shortPath,
} from '../lib/format'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ViewCommonProps {
  snapshot: Snapshot
  activeDrive: DriveSnapshot | null
  history: DriveHistoryMap
  rescanTarget: string
  onRescan: (letter: string) => void
}

interface ChatViewProps {
  drive: DriveSnapshot | null
  draft: string
  busy: boolean
  error: string
  messages: ChatMessage[]
  onDraftChange: (value: string) => void
  onSubmit: () => void
}

export function OverviewView({
  snapshot,
  activeDrive,
  history,
  rescanTarget,
  onRescan,
}: ViewCommonProps) {
  const topOpportunities = snapshot.crossDrive.topOpportunities.slice(0, 6)

  return (
    <div className="view-grid view-grid-overview">
      <Panel
        eyebrow="当前焦点"
        title={activeDrive ? `${activeDrive.letter}: 数据中枢` : '等待盘符'}
        detail={
          activeDrive
            ? `已用 ${formatBytes(activeDrive.usedBytes)} / ${formatBytes(activeDrive.totalBytes)}，上次扫描 ${formatUpdatedAt(activeDrive.lastScannedAt)}`
            : '请选择一个盘符以查看详细分析。'
        }
        action={
          activeDrive ? (
            <button
              className="ghost-button"
              disabled={rescanTarget === activeDrive.letter}
              onClick={() => onRescan(activeDrive.letter)}
            >
              {rescanTarget === activeDrive.letter ? '已加入队列' : '重新扫描'}
            </button>
          ) : null
        }
      >
        {activeDrive ? (
          <div className="hero-grid">
            <div className="hero-card hero-card-main">
              <UsageDial drive={activeDrive} />
              <div className="hero-copy">
                <p>{activeDrive.analysisSummary || '等待 AI 对当前盘做出结构化解读。'}</p>
                <div className="metric-row">
                  <MetricChip label="扫描状态" value={labelScanStatus(activeDrive.scanStatus)} />
                  <MetricChip label="AI 状态" value={labelAiStatus(activeDrive.aiStatus)} />
                  <MetricChip label="扫描耗时" value={formatDurationMs(activeDrive.scanDurationMs)} />
                  <MetricChip label="AI 耗时" value={formatDurationMs(activeDrive.aiDurationMs)} />
                </div>
              </div>
            </div>
            <div className="hero-card">
              <SectionTitle title="使用率趋势" detail="保留最近采样点，观察空间回落和增长速度。" />
              <TrendChart points={history[activeDrive.letter] ?? []} />
            </div>
          </div>
        ) : (
          <EmptyState title="暂无盘符数据" detail="后端完成首次扫描后，这里会出现中央主视区分析。" />
        )}
      </Panel>

      <Panel eyebrow="跨盘机会" title="优先清理建议" detail="按估算收益和风险等级排序，先做最值的一批。">
        <OpportunityList items={topOpportunities} />
      </Panel>

      <Panel eyebrow="重复项" title="跨盘重复目录" detail="顶层名称重复通常意味着内容可以归并或重命名。">
        <DuplicateList items={snapshot.crossDrive.duplicateTopLevelNames.slice(0, 8)} />
      </Panel>

      <Panel eyebrow="标准化" title="目录治理建议" detail="AI 和规则会一起归纳更易维护的目录结构。">
        <StandardList items={snapshot.crossDrive.standardizationSuggestions.slice(0, 8)} />
      </Panel>
    </div>
  )
}

export function DriveView({ activeDrive, rescanTarget, onRescan }: ViewCommonProps) {
  if (!activeDrive) {
    return <EmptyState title="未选择盘符" detail="从左侧盘符栏选择目标后查看该盘的热点目录和大文件。" />
  }

  return (
    <div className="view-grid view-grid-drive">
      <Panel
        eyebrow="盘面剖析"
        title={`${activeDrive.letter}: 顶层热点`}
        detail="单次遍历完成后，按大小呈现顶层目录与文件。"
        action={
          <button
            className="ghost-button"
            disabled={rescanTarget === activeDrive.letter}
            onClick={() => onRescan(activeDrive.letter)}
          >
            {rescanTarget === activeDrive.letter ? '已加入队列' : '重新扫描'}
          </button>
        }
      >
        <EntryBars items={activeDrive.topEntries} emptyText="扫描完成后会出现顶层热点。" />
      </Panel>

      <Panel eyebrow="聚焦目录" title="深度热点" detail="针对最重的几个目录继续汇总下一层，便于快速定位。">
        <FocusDirectoryList directories={activeDrive.focusDirectories} />
      </Panel>

      <Panel eyebrow="大文件" title="显著文件" detail="可直接识别镜像、安装包、录屏和压缩包等单文件大项。">
        <FileList files={activeDrive.notableFiles} />
      </Panel>
    </div>
  )
}

export function ScanView({ snapshot, activeDrive }: ViewCommonProps) {
  const liveDrive = snapshot.drives.find((drive) => drive.scanStatus === 'scanning') ?? activeDrive
  const progress = liveDrive?.scanProgress

  return (
    <div className="view-grid view-grid-scan">
      <Panel eyebrow="扫描进程" title="实时流式进度" detail="扫描器按单次遍历聚合，不再重复递归同一棵目录树。">
        {liveDrive && progress ? (
          <div className="scan-flow">
            <div className="scan-flow__headline">
              <strong>{liveDrive.letter}: 扫描链路</strong>
              <StatusBadge tone={scanTone(liveDrive.scanStatus)}>{labelScanStatus(liveDrive.scanStatus)}</StatusBadge>
            </div>
            <ProgressStrip percent={progress.percent} />
            <div className="metric-row">
              <MetricChip label="阶段" value={progress.phase || 'waiting'} />
              <MetricChip label="根任务" value={`${progress.rootsCompleted}/${progress.rootsTotal || 0}`} />
              <MetricChip label="文件" value={formatNumber(progress.filesVisited)} />
              <MetricChip label="目录" value={formatNumber(progress.directoriesVisited)} />
              <MetricChip label="已见字节" value={formatBytes(progress.bytesSeen)} />
              <MetricChip label="耗时" value={formatDurationMs(progress.elapsedMs)} />
            </div>
            <div className="scan-paths">
              <PathLine label="当前根目录" value={progress.currentRoot ?? '等待扫描器取到任务'} />
              <PathLine label="当前路径" value={progress.currentPath ?? '等待扫描器进入目录'} />
            </div>
          </div>
        ) : (
          <EmptyState title="扫描器空闲" detail="当前没有正在扫描的盘，右侧仍可查看各盘最近一次结果。" />
        )}
      </Panel>

      <Panel eyebrow="队列总览" title="各盘扫描状态" detail="查看哪些盘正在扫、哪些盘已准备好 AI 解读。">
        <DriveStatusBoard drives={snapshot.drives} />
      </Panel>
    </div>
  )
}

export function AiView({ snapshot, activeDrive }: ViewCommonProps) {
  return (
    <div className="view-grid view-grid-ai">
      <Panel eyebrow="当前盘 AI" title={activeDrive ? `${activeDrive.letter}: AI 解读` : 'AI 解读'} detail="先给出摘要，再给出可执行建议。">
        {activeDrive ? (
          <>
            <div className="summary-callout">
              <StatusBadge tone={aiTone(activeDrive.aiStatus)}>{labelAiStatus(activeDrive.aiStatus)}</StatusBadge>
              <p>{activeDrive.analysisSummary || 'AI 结果尚未返回，系统会先展示规则回退建议。'}</p>
            </div>
            <GuidanceList items={activeDrive.aiGuidance} emptyText="等待当前盘的 AI 结构化建议。" />
          </>
        ) : (
          <EmptyState title="未选择盘符" detail="从左侧选择目标盘后查看 AI 对该盘的诊断。" />
        )}
      </Panel>

      <Panel eyebrow="跨盘 AI" title="全局治理解读" detail="跨盘汇总更适合发现重复安装、缓存分散和目录碎片化。">
        <p className="text-block">{snapshot.crossDrive.summary || '跨盘 AI 总结将在完成至少一轮盘面分析后出现。'}</p>
        <StandardList items={snapshot.crossDrive.standardizationSuggestions.slice(0, 10)} />
      </Panel>

      <Panel eyebrow="AI 引擎" title="运行状态" detail="用于判断当前是否命中了 DeepSeek 结构化分析，或回退到了本地规则。">
        <div className="metric-row">
          <MetricChip label="引擎" value={snapshot.system.analysisEngine} />
          <MetricChip label="提供方" value={snapshot.system.aiProvider || 'local'} />
          <MetricChip label="模型" value={snapshot.system.aiModel ?? 'fallback'} />
          <MetricChip label="状态" value={snapshot.system.aiStatus} />
          <MetricChip label="最近完成" value={formatUpdatedAt(snapshot.system.aiLastAnalyzedAt)} />
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
  onDraftChange,
  onSubmit,
}: ChatViewProps) {
  const prompts = [
    '这个盘最值得先删什么，按风险从低到高排一下。',
    '这些热点目录里面哪些更像重复安装或缓存残留？',
    '如果我要给这个盘做长期标准化整理，推荐怎样分层？',
  ]

  return (
    <div className="view-grid view-grid-chat">
      <Panel eyebrow="对话入口" title={drive ? `${drive.letter}: AI 对话` : 'AI 对话'} detail="分析完成后，可以追问清理顺序、归档策略和目录标准化。">
        {drive ? (
          <div className="chat-layout">
            <div className="chat-transcript">
              {messages.length ? (
                messages.map((message, index) => (
                  <article key={`${message.role}-${index}`} className={`chat-bubble chat-bubble-${message.role}`}>
                    <strong>{message.role === 'assistant' ? 'AI' : '你'}</strong>
                    <p>{message.content}</p>
                  </article>
                ))
              ) : (
                <EmptyState title="还没有对话" detail="先发一个问题，AI 会基于当前盘的扫描结果回答。" />
              )}
            </div>
            <div className="prompt-row">
              {prompts.map((prompt) => (
                <button key={prompt} className="prompt-pill" onClick={() => onDraftChange(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
            <div className="chat-editor">
              <textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="例如：哪些目录适合迁移到其他盘，哪些更适合直接清缓存？"
                rows={5}
              />
              <div className="chat-toolbar">
                <span>{drive.aiStatus === 'ready' ? 'AI 已就绪，可继续追问。' : '建议等待该盘 AI 解读完成后再追问。'}</span>
                <button className="primary-button" disabled={busy || !draft.trim() || drive.scanStatus !== 'ready'} onClick={onSubmit}>
                  {busy ? 'AI 思考中...' : '发送问题'}
                </button>
              </div>
              {error ? <p className="inline-error">{error}</p> : null}
            </div>
          </div>
        ) : (
          <EmptyState title="未选择盘符" detail="先选择一个盘，再和 AI 围绕该盘做追问式分析。" />
        )}
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
    <section className="panel-shell">
      <header className="panel-header">
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

export function StatusBadge({ tone, children }: { tone: 'critical' | 'warning' | 'stable' | 'info'; children: ReactNode }) {
  return <span className={`status-badge tone-${tone}`}>{children}</span>
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="section-title">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function UsageDial({ drive }: { drive: DriveSnapshot }) {
  const style = {
    '--usage-angle': `${Math.max(8, Math.min(100, drive.usePercent)) * 3.6}deg`,
    '--drive-accent': pickDriveColor(drive.letter),
  } as CSSProperties

  return (
    <div className="usage-dial" style={style}>
      <div className="usage-dial__inner">
        <span>{drive.letter}:</span>
        <strong>{formatPercent(drive.usePercent)}</strong>
        <small>剩余 {formatBytes(drive.freeBytes)}</small>
      </div>
    </div>
  )
}

function TrendChart({ points }: { points: DriveHistoryMap[string] | undefined }) {
  if (!points?.length) {
    return <EmptyState title="趋势数据不足" detail="等待更多轮快照采样后，这里会出现容量变化曲线。" />
  }

  const width = 420
  const height = 150
  const values = points.map((point) => point.usedPercent)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width
      const y = height - ((point.usedPercent - min) / range) * (height - 18) - 9
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path className="trend-chart__grid" d={`M 0 ${height - 1} L ${width} ${height - 1}`} />
      <path className="trend-chart__line" d={path} />
    </svg>
  )
}

function ProgressStrip({ percent }: { percent: number }) {
  return (
    <div className="progress-strip">
      <div className="progress-strip__bar" style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
      <span>{formatPercent(percent)}</span>
    </div>
  )
}

function OpportunityList({ items }: { items: Opportunity[] }) {
  if (!items.length) {
    return <EmptyState title="暂未生成机会项" detail="随着扫描和 AI 解读完成，这里会自动出现可执行建议。" />
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <article key={item.id} className="stack-card">
          <div className="stack-card__head">
            <StatusBadge tone={severityTone(item.severity)}>{item.severity}</StatusBadge>
            <strong>{item.title}</strong>
            <span>{formatBytes(item.estimatedBytes)}</span>
          </div>
          <p>{item.action}</p>
          <code>{shortPath(item.path)}</code>
        </article>
      ))}
    </div>
  )
}

function DuplicateList({ items }: { items: DuplicateNameGroup[] }) {
  if (!items.length) {
    return <EmptyState title="重复项不明显" detail="当前没有显著的跨盘顶层重名目录。" />
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <article key={`${item.name}-${item.combinedBytes}`} className="stack-card">
          <div className="stack-card__head">
            <strong>{item.name}</strong>
            <span>{formatBytes(item.combinedBytes)}</span>
          </div>
          <p>{item.drives.join(' / ')}</p>
          <code>{shortPath(item.paths[0] ?? item.name)}</code>
        </article>
      ))}
    </div>
  )
}

function StandardList({ items }: { items: StandardizationSuggestion[] }) {
  if (!items.length) {
    return <EmptyState title="尚未生成标准化建议" detail="完成更多盘面分析后会产生更稳定的治理建议。" />
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

function EntryBars({ items, emptyText }: { items: DriveSnapshot['topEntries']; emptyText: string }) {
  if (!items.length) {
    return <EmptyState title="暂无顶层热点" detail={emptyText} />
  }

  const max = Math.max(...items.map((item) => item.sizeBytes), 1)
  return (
    <div className="bars">
      {items.map((item) => (
        <article key={item.path} className="bar-row">
          <div className="bar-row__meta">
            <strong>{item.name}</strong>
            <span>{formatBytes(item.sizeBytes)}</span>
          </div>
          <div className="bar-row__track">
            <span style={{ width: `${(item.sizeBytes / max) * 100}%` }} />
          </div>
          <code>{shortPath(item.path)}</code>
        </article>
      ))}
    </div>
  )
}

function FocusDirectoryList({ directories }: { directories: DriveSnapshot['focusDirectories'] }) {
  if (!directories.length) {
    return <EmptyState title="暂无聚焦目录" detail="扫描器会自动挑选最重的几个目录并继续聚合下一层。" />
  }

  return (
    <div className="stack-list">
      {directories.map((directory) => (
        <article key={directory.path} className="stack-card">
          <div className="stack-card__head">
            <strong>{directory.name}</strong>
            <span>{formatBytes(directory.sizeBytes)}</span>
          </div>
          <code>{shortPath(directory.path)}</code>
          <div className="sub-list">
            {directory.children.map((child) => (
              <div key={child.path} className="sub-list__item">
                <span>{child.name}</span>
                <span>{formatBytes(child.sizeBytes)}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

function FileList({ files }: { files: DriveSnapshot['notableFiles'] }) {
  if (!files.length) {
    return <EmptyState title="暂无显著文件" detail="大文件会在扫描结果里单独列出。" />
  }

  return (
    <div className="stack-list">
      {files.map((file) => (
        <article key={file.path} className="stack-card">
          <div className="stack-card__head">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.sizeBytes)}</span>
          </div>
          <p>{file.extension || '文件'}</p>
          <code>{shortPath(file.path)}</code>
        </article>
      ))}
    </div>
  )
}

function GuidanceList({ items, emptyText }: { items: DriveSnapshot['aiGuidance']; emptyText: string }) {
  if (!items.length) {
    return <EmptyState title="AI 指导未返回" detail={emptyText} />
  }

  return (
    <div className="stack-list">
      {items.map((item, index) => (
        <article key={`${item.title}-${index}`} className="stack-card">
          <div className="stack-card__head">
            <StatusBadge tone={guidanceTone(item.tone)}>{item.tone}</StatusBadge>
            <strong>{item.title}</strong>
          </div>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  )
}

function DriveStatusBoard({ drives }: { drives: Snapshot['drives'] }) {
  return (
    <div className="drive-status-board">
      {drives.map((drive) => (
        <article key={drive.letter} className="drive-status-card">
          <div className="drive-status-card__head">
            <strong>{drive.letter}:</strong>
            <StatusBadge tone={scanTone(drive.scanStatus)}>{labelScanStatus(drive.scanStatus)}</StatusBadge>
          </div>
          <div className="metric-row">
            <MetricChip label="占用率" value={formatPercent(drive.usePercent)} />
            <MetricChip label="扫描" value={formatDurationMs(drive.scanDurationMs)} />
            <MetricChip label="AI" value={labelAiStatus(drive.aiStatus)} />
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

function pickDriveColor(letter: string) {
  const colors = ['#62e5ff', '#79a2ff', '#a586ff', '#36d6c5', '#4f8bff', '#7ce7ff']
  return colors[letter.charCodeAt(0) % colors.length]
}

function labelScanStatus(status: string) {
  if (status === 'ready') return '已完成'
  if (status === 'scanning') return '扫描中'
  if (status === 'error') return '异常'
  return '排队中'
}

function labelAiStatus(status: string) {
  if (status === 'ready') return '已完成'
  if (status === 'analyzing') return '分析中'
  if (status === 'error') return '异常'
  if (status === 'queued') return '排队中'
  return '待启动'
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
  return 'warning'
}
