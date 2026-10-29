import { useState } from 'react'
import type { ReleaseInfo } from '@shared/types'
import { renderMarkdown } from '../markdown'
import { useStore } from '../store'
import { RefreshIcon } from './Icons'

/** How many versions below the current one are offered for rolling back. */
const ROLLBACK_DEPTH = 3

const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(0)} MB`

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return day(ms)
}

function compare(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

function ReleaseRow({ release, current }: { release: ReleaseInfo; current: string }) {
  const u = useStore((s) => s.updates)!
  const [confirming, setConfirming] = useState(false)
  const order = compare(release.version, current)
  const isCurrent = order === 0
  const busy = u.downloading?.version === release.version
  const verb = order > 0 ? 'Update' : 'Roll back'
  const install = async (): Promise<void> => {
    setConfirming(false)
    try {
      await window.twilight.installVersion(release.version)
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }
  return (
    <li className="release-row" data-version={release.version}>
      <div className="release-head">
        <span className="release-version">{release.version}</span>
        {isCurrent && <span className="tw-badge cap-badge">Installed</span>}
        {order > 0 && release.version === u.latest && <span className="tw-badge cap-badge">Newest</span>}
        {u.cached.includes(release.version) && !isCurrent && <span className="tw-badge cap-badge">Downloaded</span>}
        <span className="release-date">
          {release.publishedAt ? day(release.publishedAt) : ''}
          {release.installer ? ` · ${mb(release.installer.size)}` : ''}
        </span>
        {!isCurrent && release.installer && (
          busy ? (
            <span className="release-progress" role="progressbar" aria-valuenow={u.downloading!.received} aria-valuemax={u.downloading!.total}>
              <span style={{ width: `${Math.round((u.downloading!.received / Math.max(1, u.downloading!.total)) * 100)}%` }} />
            </span>
          ) : confirming ? (
            <span className="release-confirm">
              <button className={`tw-btn tw-btn-sm ${order > 0 ? 'tw-btn-primary' : ''}`} onClick={() => void install()}>
                {verb} to {release.version}
              </button>
              <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              className={`tw-btn tw-btn-sm ${order > 0 ? 'tw-btn-primary' : 'tw-btn-ghost'}`}
              disabled={!!u.downloading}
              onClick={() => setConfirming(true)}
            >
              {verb}
            </button>
          )
        )}
      </div>
      {confirming && (
        <p className="field-note">
          Twilight backs up your data, closes, installs {release.version}
          {u.canInstall ? ' and opens again' : ''}. Your chats, documents and settings carry over.
          {order < 0 ? ' Anything a newer version added that this one doesn’t know about stays in the backup.' : ''}
        </p>
      )}
      {release.notes.trim() && (
        <details className="release-notes" open={order > 0 && release.version === u.latest}>
          <summary>What’s in {release.version}</summary>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(`release:${release.version}`, release.notes) }} />
        </details>
      )}
    </li>
  )
}

export function UpdatesSection() {
  const u = useStore((s) => s.updates)
  if (!u) return null
  const installedAt = u.history.findLast((h) => h.version === u.current)?.installedAt
  const earlier = u.history.filter((h) => h.version !== u.current).slice(-ROLLBACK_DEPTH).reverse()
  const newer = u.releases.filter((r) => compare(r.version, u.current) > 0)
  const older = u.releases.filter((r) => compare(r.version, u.current) < 0).slice(0, ROLLBACK_DEPTH)
  const here = u.releases.filter((r) => compare(r.version, u.current) === 0)
  const shown = [...newer, ...here, ...older]

  return (
    <>
      <div className="settings-card">
        <h3 className="t-heading">Twilight {u.current}</h3>
        <p className="field-note">
          {installedAt ? `Running since ${day(installedAt)}.` : ''}
          {earlier.length > 0 && ` Before that: ${earlier.map((h) => `${h.version} (${day(h.installedAt)})`).join(', ')}.`}
        </p>
        <div className="update-status">
          <span className={`status-dot ${u.error ? 'status-error' : u.latest ? 'status-warn' : u.lastChecked ? 'status-ok' : ''}`} />
          <span className="update-status-text">
            {u.checking
              ? 'Checking…'
              : u.error
                ? u.error
                : u.latest
                  ? `Twilight ${u.latest} is available.`
                  : u.lastChecked
                    ? 'You have the newest version.'
                    : 'Not checked yet.'}
          </span>
          {u.lastChecked && !u.checking && <span className="field-note">Checked {ago(u.lastChecked)}</span>}
          <button className="tw-btn tw-btn-sm" disabled={u.checking} onClick={() => void window.twilight.checkForUpdates()}>
            <RefreshIcon className={u.checking ? 'spinning' : ''} />
            Check now
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={u.autoCheck} onChange={(e) => void window.twilight.setAutoUpdateCheck(e.target.checked)} />
          Check for updates once a day
        </label>
      </div>

      {shown.length > 0 && (
        <div className="settings-card">
          <h3 className="t-heading">Versions</h3>
          <p className="field-note">
            Newer releases, this one, and up to {ROLLBACK_DEPTH} earlier ones to roll back to. Before any switch Twilight saves a copy of its database
            (the last 3 are kept).
          </p>
          <ul className="release-list">
            {shown.map((r) => (
              <ReleaseRow key={r.version} release={r} current={u.current} />
            ))}
          </ul>
          {!u.canInstall && <p className="field-note updates-dev-note">This is a development build: installers download but don’t run.</p>}
        </div>
      )}

      <div className="settings-card">
        <div className="field-inline">
          <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => void window.twilight.openBackupsFolder()}>
            Open backups folder
          </button>
          <button className="tw-btn tw-btn-sm tw-btn-ghost" onClick={() => void window.twilight.openExternal(u.releasesPage)}>
            Open the releases page
          </button>
        </div>
      </div>
    </>
  )
}
