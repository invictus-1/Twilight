import { useEffect, useState } from 'react'
import type { BackupInfo, BackupSettings, DataInfo } from '@shared/backups'
import { useStore } from '../store'
import { FolderIcon, RefreshIcon, TrashIcon } from './Icons'

// Settings → Data: where Twilight keeps its data, moving it, and backups you can go back to.

const api = window.twilight
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const REASONS: Record<BackupInfo['reason'], string> = { manual: 'by you', scheduled: 'scheduled', 'before-restore': 'before a restore', 'before-move': 'before a move' }
const SCHEDULES: { id: BackupSettings['schedule']; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' }
]

const size = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
const when = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** A button that asks once more: the first click arms it, the second does it. */
function Confirm({ label, armed, className, onConfirm }: { label: string; armed: string; className?: string; onConfirm: () => void }) {
  const [sure, setSure] = useState(false)
  return sure ? (
    <button className="tw-btn tw-btn-sm tw-btn-danger" autoFocus onBlur={() => setSure(false)} onClick={onConfirm}>
      {armed}
    </button>
  ) : (
    <button className={className ?? 'tw-btn tw-btn-ghost tw-btn-sm'} onClick={() => setSure(true)}>
      {label}
    </button>
  )
}

export function DataSection() {
  const [info, setInfo] = useState<DataInfo | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const refresh = (): void => {
    void api.getDataInfo().then(setInfo)
    void api.listBackups().then(setBackups)
  }
  useEffect(refresh, [])
  const fail = (err: unknown): void => useStore.getState().setError(errText(err))
  if (!info) return null
  const b = info.backups
  return (
    <>
      <div className="settings-card data-where">
        <h3 className="t-heading">Where your data lives</h3>
        <p className="field-note">Chats, workspaces, settings, encrypted keys, your background and the pictures chats made. Updating or reinstalling Twilight never touches it.</p>
        <div className="field-inline">
          <span className="folder-path log-path">{info.folder}</span>
          <button className="tw-btn tw-btn-sm" onClick={() => void api.openDataFolder()}>
            Open folder
          </button>
        </div>
        <div className="data-actions">
          <button
            className="tw-btn tw-btn-sm"
            onClick={() =>
              void api
                .moveData()
                .then((why) => setNote(why))
                .catch(fail)
            }
          >
            <FolderIcon size={14} />
            Move to another folder…
          </button>
          {info.moved && <Confirm label="Move back to the standard place" armed="Restart and move back" onConfirm={() => void api.moveDataBack().then(setNote).catch(fail)} />}
        </div>
        <p className="field-note">
          Twilight backs up first, restarts, copies everything to the new folder and checks the copy before using it. The old copy stays where it was until you remove it yourself.
        </p>
        {note && (
          <p className="form-error" role="alert">
            {note}
          </p>
        )}
        {info.lastChange && (
          <p className="field-note data-last">
            {info.lastChange.kind === 'restored' ? `Restored from ${info.lastChange.detail}` : info.lastChange.kind === 'moved' ? `Moved here: ${info.lastChange.detail}` : `The last move didn't happen: ${info.lastChange.detail}`} ·{' '}
            {when(info.lastChange.at)}
          </p>
        )}
      </div>

      <div className="settings-card data-backups">
        <h3 className="t-heading">Backups</h3>
        <p className="field-note">
          Each backup is a plain folder with everything above, plus your theme, motion and shortcut settings. Your writing folder isn&apos;t included: those are your own files.
        </p>
        <div className="data-row">
          <span className="field-label">Automatic</span>
          <div className="tw-seg backup-seg" role="radiogroup" aria-label="Automatic backups">
            {SCHEDULES.map((s) => (
              <button key={s.id} role="radio" aria-checked={b.schedule === s.id} aria-pressed={b.schedule === s.id} onClick={() => void api.setBackupSettings({ schedule: s.id }).then(setInfo)}>
                {s.label}
              </button>
            ))}
          </div>
          <label className="data-keep">
            Keep the last
            <input
              type="number"
              min={1}
              max={100}
              value={b.keep}
              onChange={(e) => void api.setBackupSettings({ keep: Math.min(100, Math.max(1, Number(e.target.value) || 1)) }).then(setInfo)}
            />
          </label>
        </div>
        <p className="field-note">
          {b.schedule === 'off' ? 'No automatic backups.' : `A backup ${b.schedule === 'daily' ? 'each day' : 'each week'}, a minute after Twilight starts when one is due.`} Older automatic ones go to the
          Recycle Bin; ones you make stay until you remove them.
          {b.last && ` Last automatic backup: ${when(b.last)}.`}
        </p>
        {b.lastError && <p className="form-error">The last automatic backup failed: {b.lastError}</p>}
        <div className="field-inline">
          <span className="folder-path log-path">{b.resolvedFolder}</span>
          <button className="tw-btn tw-btn-sm" onClick={() => void api.chooseBackupFolder().then(setInfo)}>
            Change
          </button>
          <button className="tw-btn tw-btn-sm" onClick={() => void api.openBackupFolder()}>
            Open
          </button>
        </div>
        <div className="data-actions">
          <button
            className="tw-btn tw-btn-primary tw-btn-sm backup-now"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void api
                .backupNow()
                .then(() => refresh())
                .catch(fail)
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <span className="tw-spin" /> : <RefreshIcon size={14} />}
            Back up now
          </button>
        </div>
        <div className="backup-list">
          {backups.map((x) => (
            <div key={x.path} className="backup-item" data-reason={x.reason}>
              <div className="backup-what">
                <span className="backup-name">{when(x.createdAt)}</span>
                <span className="field-note">
                  {REASONS[x.reason]} · {x.chats} chat{x.chats === 1 ? '' : 's'} · {size(x.bytes)} · Twilight {x.version}
                </span>
              </div>
              <Confirm label="Restore" armed="Back up current, then restart into this" className="tw-btn tw-btn-sm" onConfirm={() => void api.restoreBackup(x.path).catch(fail)} />
              <button
                className="tw-btn tw-btn-ghost tw-btn-icon"
                aria-label={`Remove the backup from ${when(x.createdAt)}`}
                title="Send this backup to the Recycle Bin"
                onClick={() => void api.removeBackup(x.path).then(setBackups).catch(fail)}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
          {backups.length === 0 && <p className="sidebar-empty">No backups yet.</p>}
        </div>
      </div>
    </>
  )
}
