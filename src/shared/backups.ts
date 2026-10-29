// Backups and where Twilight keeps its data (Settings → Data).

export interface BackupSettings {
  schedule: 'off' | 'daily' | 'weekly'
  /** Scheduled backups kept; older ones go to the Recycle Bin. Ones you make are kept until you remove them. */
  keep: number
  /** Where backups go; empty for "Twilight backups" in Documents. */
  folder: string
}

export interface BackupInfo {
  name: string
  path: string
  createdAt: number
  /** Why it was made: by you, on the schedule, or before a restore or a move. */
  reason: 'manual' | 'scheduled' | 'before-restore' | 'before-move'
  version: string
  chats: number
  bytes: number
}

export interface DataInfo {
  /** Where the data lives now. */
  folder: string
  /** True when it's not the standard place. */
  moved: boolean
  /** The standard place, for moving back. */
  standard: string
  /** What the last start did with a move or restore you asked for. */
  lastChange: { kind: 'moved' | 'restored' | 'move-failed'; detail: string; at: number } | null
  backups: BackupSettings & { resolvedFolder: string; last: number | null; lastError: string | null }
}
