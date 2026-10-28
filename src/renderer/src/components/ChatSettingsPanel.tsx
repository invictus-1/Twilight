import { useState } from 'react'
import type { CacheTtl, ChatSettings, Effort, Pane } from '@shared/types'
import { paneOf, useStore } from '../store'
import { CloseIcon } from './Icons'

const EFFORTS: (Effort | null)[] = [null, 'low', 'medium', 'high', 'xhigh', 'max']

export function ChatSettingsPanel({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.current)!
  const providers = useStore((s) => s.providers)
  const [pane, setPane] = useState<Pane>('a')
  const shown: Pane = current.split ? pane : 'a'
  const { settings } = paneOf(current, shown)
  const started = current.started
  const update = (patch: Partial<ChatSettings>): Promise<void> => useStore.getState().updateSettings(patch, shown)
  const isClaude = providers.find((p) => p.id === settings.providerId)?.kind === 'anthropic'

  return (
    <section className="panel" aria-label="Chat settings" key={shown}>
      <div className="panel-head">
        <h2 className="t-heading">Chat settings</h2>
        {current.split && (
          <div className="tw-seg" role="group" aria-label="Pane">
            <button className="tw-seg-a" aria-pressed={shown === 'a'} onClick={() => setPane('a')}>
              A
            </button>
            <button className="tw-seg-b" aria-pressed={shown === 'b'} onClick={() => setPane('b')}>
              B
            </button>
          </div>
        )}
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <label className="field">
        <span className="field-label">System prompt</span>
        <textarea
          rows={4}
          defaultValue={settings.systemPrompt}
          disabled={started}
          placeholder="Instructions the model follows for this whole chat"
          onBlur={(e) => void update({ systemPrompt: e.currentTarget.value })}
        />
        {started && (
          <span className="field-note">
            Locked once the chat starts, so the cached prefix never changes. Start a new chat to use a different one.
          </span>
        )}
      </label>

      {isClaude && (
        <div className="field-row">
          <label className="field">
            <span className="field-label">Effort</span>
            <select value={settings.effort ?? ''} onChange={(e) => void update({ effort: (e.target.value || null) as Effort | null })}>
              {EFFORTS.map((e) => (
                <option key={e ?? 'default'} value={e ?? ''}>
                  {e ?? 'Model default'}
                </option>
              ))}
            </select>
            {started && <span className="field-note">Changing effort mid-chat re-caches the conversation once.</span>}
          </label>
          <label className="field">
            <span className="field-label">Cache lifetime</span>
            <select value={settings.cacheTtl} onChange={(e) => void update({ cacheTtl: e.target.value as CacheTtl })}>
              <option value="1h">1 hour (for pauses between messages)</option>
              <option value="5m">5 minutes (rapid back-and-forth)</option>
            </select>
          </label>
        </div>
      )}

      {!isClaude && (
        <label className="field">
          <span className="field-label">Temperature</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            placeholder="Server default"
            defaultValue={settings.temperature ?? ''}
            onBlur={(e) => void update({ temperature: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
          />
        </label>
      )}

      <label className="check">
        <input type="checkbox" checked={settings.showThinking} onChange={(e) => void update({ showThinking: e.target.checked })} />
        Show the model's thinking
      </label>
    </section>
  )
}
