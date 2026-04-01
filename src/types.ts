export type HealthLevel = 'critical' | 'warning' | 'stable'
export type ScanState = 'queued' | 'scanning' | 'ready' | 'error'

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

export interface DriveSnapshot {
  letter: string
  mount: string
  fsType: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usePercent: number
  health: HealthLevel
  analysisStatus: ScanState
  lastScannedAt: string | null
  scanDurationMs: number | null
  scanError: string | null
  topEntries: Entry[]
  focusDirectories: FocusDirectory[]
  notableFiles: Entry[]
  opportunities: Opportunity[]
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
  activeScan: string | null
  historySamples: number
  uptimeMinutes: number
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
}

export interface Snapshot {
  generatedAt: string
  system: SystemSnapshot
  drives: DriveSnapshot[]
  crossDrive: CrossDriveSnapshot
}

export interface DriveHistoryPoint {
  at: string
  freePercent: number
  usedPercent: number
}

export type DriveHistoryMap = Record<string, DriveHistoryPoint[]>
