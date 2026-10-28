import { useEffect, useState } from 'react'
import type { CacheTtl, ChatSettings, Pane, SettingsPreset } from '@shared/types'
import { modelName, optionsFor, paneOf, useStore } from '../store'
import { CloseIcon, TrashIcon } from './Icons'

/** Settings a preset carries (everything about how the model is asked, not which chat). */
const PRESET_KEYS: (keyof ChatSettings)[] = [
  'effort', 'thinkingDisplay', 'caching', 'cacheTtl', 'temperature', 'maxTokens', 'messageLimit', 'extraParams', 'systemPrompt', 'choiceCards'
]

/** A switchable number with a slider, like "Max output tokens". Off means "not sent". */
function NumberSetting(props: {
  label: string
  value: number | null
  fallback: number
  min: number
  max: number
  step: number
  disabled?: string
  note?: string
  onChange: (value: number | null) => void
}) {
  const on = props.value !== null && !props.disabled
  const shown = props.value ?? props.fallback
  return (
    <div className={`num-setting ${on ? '' : 'num-off'}`}>
      <div className="num-head">
        <label className="check">
          <input type="checkbox" checked={on} disabled={!!props.disabled} onChange={(e) => props.onChange(e.target.checked ? props.fallback : null)} />
          <span className="t-label">{props.label}</span>
        </label>
        <input
          className="num-input"
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          value={shown}
          disabled={!on}
          onChange={(e) => props.onChange(Math.min(props.max, Math.max(props.min, Number(e.target.value) || props.min)))}
        />
      </div>
      <input
        type="range"
        className="num-range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={shown}
        disabled={!on}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {(props.disabled || props.note) && <span className="field-note">{props.disabled ?? props.note}</span>}
    </div>
  )
}

export function ChatSettingsPanel({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.current)!
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const [pane, setPane] = useState<Pane>('a')
  const [presets, setPresets] = useState<SettingsPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [cacheBar, setCacheBar] = useState(() => !readHidden())
  const shown: Pane = current.split ? pane : 'a'
  const { settings } = paneOf(current, shown)
  const provider = providers.find((p) => p.id === settings.providerId)
  const options = optionsFor(models, providers, settings.providerId, settings.modelId)
  const update = (patch: Partial<ChatSettings>): Promise<void> => useStore.getState().updateSettings(patch, shown)
  const [extra, setExtra] = useState(settings.extraParams)
  const extraError = (() => {
    if (!extra.trim()) return null
    try {
      const v = JSON.parse(extra)
      return typeof v === 'object' && v && !Array.isArray(v) ? null : 'Must be a JSON object'
    } catch {
      return 'Not valid JSON yet'
    }
  })()

  useEffect(() => {
    void window.twilight.listPresets().then(setPresets)
  }, [])
  useEffect(() => setExtra(settings.extraParams), [settings.extraParams, shown])

  const defaultEffortLabel = options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'

  return (
    <section className="panel settings-panel" aria-label="Model settings" key={shown}>
      <div className="panel-head">
        <h2 className="t-heading">Model settings</h2>
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
      <p className="field-note">
        {modelName(models, settings.modelId)} · {provider?.name ?? settings.providerId}
      </p>

      <div className="preset-row">
        <select
          value=""
          onChange={(e) => {
            const preset = presets.find((p) => p.name === e.target.value)
            if (preset) void update(preset.settings)
          }}
        >
          <option value="">{presets.length ? 'Apply a preset…' : 'No presets yet'}</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <input placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
        <button
          className="tw-btn tw-btn-sm"
          disabled={!presetName.trim()}
          onClick={async () => {
            const picked = Object.fromEntries(PRESET_KEYS.map((k) => [k, settings[k]])) as Partial<ChatSettings>
            setPresets(await window.twilight.savePreset({ name: presetName.trim(), settings: picked }))
            setPresetName('')
          }}
        >
          Save
        </button>
        {presets.some((p) => p.name === presetName.trim()) && (
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon"
            aria-label="Delete preset"
            onClick={async () => setPresets(await window.twilight.deletePreset(presetName.trim()))}
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>

      <label className="field">
        <span className="field-label">System prompt{current.split ? ` (pane ${shown.toUpperCase()})` : ''}</span>
        <textarea
          key={`${shown}-sp`}
          rows={5}
          defaultValue={settings.systemPrompt}
          placeholder="Instructions the model follows for this chat"
          onBlur={(e) => e.currentTarget.value !== settings.systemPrompt && void update({ systemPrompt: e.currentTarget.value })}
        />
        {current.started && (
          <span className="field-note">
            Editable any time. Sent with every message; a change restarts the prompt cache for this chat
            {current.split ? ' pane' : ''}.
          </span>
        )}
      </label>

      <label className="check">
        <input type="checkbox" checked={settings.choiceCards} onChange={(e) => void update({ choiceCards: e.target.checked })} />
        Choice cards: the model can offer clickable options (text adventures)
      </label>

      <h3 className="settings-section">Common</h3>
      <NumberSetting
        label="Recent message limit"
        value={settings.messageLimit}
        fallback={30}
        min={2}
        max={500}
        step={2}
        note={settings.messageLimit ? 'Older messages are left out in steps, so the cache only restarts when the cut moves.' : 'Off: the whole conversation is sent.'}
        onChange={(messageLimit) => void update({ messageLimit })}
      />
      <NumberSetting
        label="Temperature"
        value={options.temperature ? settings.temperature : null}
        fallback={0.7}
        min={0}
        max={2}
        step={0.05}
        disabled={options.temperature ? undefined : 'This model doesn’t accept temperature.'}
        onChange={(temperature) => void update({ temperature })}
      />
      <NumberSetting
        label="Max output tokens"
        value={settings.maxTokens}
        fallback={Math.min(16000, options.maxOutput ?? 16000)}
        min={256}
        max={options.maxOutput ?? 128000}
        step={256}
        note={settings.maxTokens ? undefined : provider?.kind === 'anthropic' ? `Off: up to ${Math.min(64000, options.maxOutput ?? 64000).toLocaleString()}.` : 'Off: the server decides.'}
        onChange={(maxTokens) => void update({ maxTokens })}
      />

      {options.efforts.length > 0 && (
        <label className="field">
          <span className="field-label">Thinking effort</span>
          <select value={settings.effort ?? ''} onChange={(e) => void update({ effort: e.target.value || null })}>
            <option value="">{defaultEffortLabel}</option>
            {options.efforts.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <span className="field-note">
            {options.effortsFromProvider
              ? `Levels as ${provider?.name ?? 'the provider'} lists them for this model.`
              : 'Standard level names; this server may ignore them for models without reasoning.'}
            {current.started && ' Changing effort mid-chat re-caches the conversation once.'}
          </span>
        </label>
      )}
      {options.adaptiveThinking && (
        <label className="field">
          <span className="field-label">Thinking display</span>
          <select value={settings.thinkingDisplay} onChange={(e) => void update({ thinkingDisplay: e.target.value as ChatSettings['thinkingDisplay'] })}>
            <option value="summarized">Summarized (readable)</option>
            <option value="omitted">Omitted (thinking still happens, nothing returned)</option>
          </select>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={settings.showThinking} onChange={(e) => void update({ showThinking: e.target.checked })} />
        Show the model's thinking in the chat
      </label>

      {options.caching ? (
        <div className="field">
          <label className="check">
            <input type="checkbox" checked={settings.caching} onChange={(e) => void update({ caching: e.target.checked })} />
            <span className="t-label">Prompt caching</span>
          </label>
          <select value={settings.cacheTtl} disabled={!settings.caching} onChange={(e) => void update({ cacheTtl: e.target.value as CacheTtl })}>
            <option value="1h">1 hour (for pauses between messages)</option>
            <option value="5m">5 minutes (rapid back-and-forth)</option>
          </select>
        </div>
      ) : (
        <p className="field-note">This server reuses its own cache for an unchanged conversation; there's nothing to switch.</p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={cacheBar}
          onChange={(e) => {
            writeHidden(!e.target.checked)
            setCacheBar(e.target.checked)
          }}
        />
        Show the cache status bar under the chat
      </label>

      <h3 className="settings-section">Advanced</h3>
      <label className="field">
        <span className="field-label">Extra request parameters (JSON)</span>
        <textarea
          className="code-input"
          rows={4}
          value={extra}
          placeholder={provider?.kind === 'anthropic' ? '{ "metadata": { "user_id": "me" } }' : '{ "top_k": 40, "min_p": 0.05 }'}
          onChange={(e) => setExtra(e.target.value)}
          onBlur={() => !extraError && extra !== settings.extraParams && void update({ extraParams: extra })}
        />
        <span className={`field-note ${extraError ? 'danger-text' : ''}`}>
          {extraError ?? 'Merged into the request last, so it can set anything the provider accepts, in its own format.'}
        </span>
      </label>
    </section>
  )
}

// The cache status bar can be hidden; that choice is per machine, kept in local storage.
const HIDE_KEY = 'twilight.hideCacheBar'
export function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}
export function writeHidden(hidden: boolean): void {
  try {
    localStorage.setItem(HIDE_KEY, hidden ? '1' : '0')
    window.dispatchEvent(new Event('twilight-cachebar'))
  } catch {
    /* storage unavailable: the bar just stays visible */
  }
}
