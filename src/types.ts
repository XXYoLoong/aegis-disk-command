export type HealthLevel = 'critical' | 'warning' | 'stable'
export type ScanState = 'queued' | 'scanning' | 'ready' | 'error'
export type AiState = 'idle' | 'queued' | 'analyzing' | 'ready' | 'error'
export type UiThemeMode = 'system' | 'dark' | 'light'
export type LanguageMode = 'zh-CN' | 'en-US'
export type ReportStyle = 'default' | 'gov-report'

export interface Entry {
  name: string
  path: string
  type: 'dir' | 'file'
  extension: string | null
  sizeBytes: number
}

export interface FocusDirectory {
  name: string
  path: string
  sizeBytes: number
  children: Entry[]
}

export interface Opportunity {
  id: string
  drive: string
  path: string
  category: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  action: string
  estimatedBytes: number
}

export interface GuidanceItem {
  title: string
  detail: string
  tone: 'critical' | 'warning' | 'stable' | 'info'
}

export interface ScanProgress {
  phase: string
  percent: number
  rootsCompleted: number
  rootsTotal: number
  filesVisited: number
  directoriesVisited: number
  bytesSeen: number
  currentRoot: string | null
  currentPath: string | null
  elapsedMs: number
  updatedAt: string | null
}

export interface DriveSnapshot {
  letter: string
  mount: string
  fsType: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usePercent: number
  health: HealthLevel
  scanStatus: ScanState
  aiStatus: AiState
  lastScannedAt: string | null
  lastAiAnalyzedAt: string | null
  scanDurationMs: number | null
  aiDurationMs: number | null
  scanError: string | null
  aiError: string | null
  scanProgress: ScanProgress
  topEntries: Entry[]
  focusDirectories: FocusDirectory[]
  notableFiles: Entry[]
  opportunities: Opportunity[]
  analysisSource: string
  analysisSummary: string
  aiGuidance: GuidanceItem[]
}

export interface SystemSnapshot {
  hostName: string
  platform: string
  cpuLoadPercent: number
  memoryUsedPercent: number
  totalBytes: number
  usedBytes: number
  freeBytes: number
  driveCount: number
  queueDepth: number
  scanQueueDepth: number
  aiQueueDepth: number
  activeScan: string | null
  activeAi: string | null
  historySamples: number
  uptimeMinutes: number
  analysisEngine: string
  aiEnabled: boolean
  aiProvider: string
  aiModel: string | null
  aiStatus: string
  aiLastError: string | null
  aiLastAnalyzedAt: string | null
  selectedProvider: string
  language: LanguageMode
  reportStyle: ReportStyle
  setupRequired: boolean
}

export interface DuplicateNameGroup {
  name: string
  drives: string[]
  combinedBytes: number
  paths: string[]
}

export interface StandardizationSuggestion {
  title: string
  detail: string
}

export interface CrossDriveSnapshot {
  duplicateTopLevelNames: DuplicateNameGroup[]
  standardizationSuggestions: StandardizationSuggestion[]
  topOpportunities: Opportunity[]
  summary: string
}

export interface ProviderClientConfig {
  id: string
  names: { zh: string; en: string }
  description: { zh: string; en: string }
  docsUrl: string
  protocol: string
  baseUrl: string
  model: string
  timeoutMs: number
  apiKeySet: boolean
  apiKeyPreview: string
}

export interface ClientSettings {
  ui: {
    themeMode: UiThemeMode
    language: LanguageMode
    reportStyle: ReportStyle
  }
  runtime: {
    selectedProvider: string
    allowOfflineCache: boolean
    autoSaveOnlineCache: boolean
  }
  providers: Record<string, ProviderClientConfig>
  localPaths: {
    root: string
    settingsPath: string
    secretsPath: string
    cachePath: string
  }
  setupRequired: boolean
  cachedAt: string | null
}

export interface Snapshot {
  generatedAt: string
  system: SystemSnapshot
  drives: DriveSnapshot[]
  crossDrive: CrossDriveSnapshot
  settings: ClientSettings
}

export interface DriveHistoryPoint {
  at: string
  freePercent: number
  usedPercent: number
}

export type DriveHistoryMap = Record<string, DriveHistoryPoint[]>
