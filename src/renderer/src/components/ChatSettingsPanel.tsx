import { useEffect, useRef, useState } from 'react'
import type { CacheTtl, ChatSettings, Pane, SettingsPreset } from '@shared/types'
import type { Persona } from '@shared/library'
import { useLibrary } from '../libraryStore'
import { modelName, optionsFor, paneOf, useStore } from '../store'
import { modelKey, pickModelDefaults, type ModelDefaults } from '@shared/modelDefaults'
import { CloseIcon, PinIcon, TrashIcon } from './Icons'

/** Settings a preset carries (everything about how the model is asked, not which chat). */
const PRESET_KEYS: (keyof ChatSettings)[] = [
  'effort', 'thinkingDisplay', 'caching', 'cacheTtl', 'temperature', 'maxTokens', 'messageLimit', 'extraParams', 'systemPrompt', 'choiceCards', 'choiceTool', 'choiceFenced', 'choicePlain', 'choiceInstructions',
  'webSearch', 'webFetch', 'dateTime'
]

/** A switchable number with a slider, like "Max output tokens". Off means "not sent". */
function NumberSetting(props: {
  label: string
  value: number | null
  fallback: number
  min: number
  max: number
  step: number
  /** The box's own step when it should be finer than the slider's (any whole number of tokens, say). */
  inputStep?: number
  disabled?: string
  note?: string
  onChange: (value: number | null) => void
}) {
  const on = props.value !== null && !props.disabled
  const shown = props.value ?? props.fallback
  // What's typed is kept as typed until it's a number in range, so "1000" isn't clamped to the
  // minimum at its first digit; leaving the box settles anything out of range.
  const [draft, setDraft] = useState<string | null>(null)
  const type = (text: string): void => {
    setDraft(text)
    const n = Number(text)
    if (text.trim() && Number.isFinite(n) && n >= props.min && n <= props.max) props.onChange(n)
  }
  const settle = (): void => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() && Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, n)))
    setDraft(null)
  }
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
          step={props.inputStep ?? props.step}
          value={draft ?? shown}
          disabled={!on}
          onChange={(e) => type(e.target.value)}
          onBlur={settle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
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

/**
 * Applies a persona from the library. Before the first message it sets everything the persona
 * has; after, it changes only the instructions, either in the system prompt (the cache restarts)
 * or from the next message on (the cache holds).
 */
function PersonaRow(props: { settings: ChatSettings; started: boolean; split: boolean; apply: (patch: Partial<ChatSettings>) => Promise<void> }) {
  const personas = useLibrary((s) => s.personas)
  const [picked, setPicked] = useState('')
  useEffect(() => void useLibrary.getState().refresh(), [])
  const persona = personas.find((p) => p.id === picked)
  const everything = (p: Persona): Partial<ChatSettings> => ({
    systemPrompt: p.systemPrompt,
    ...(p.providerId && p.modelId ? { providerId: p.providerId, modelId: p.modelId } : {}),
    ...(p.choiceCards ? { choiceCards: true } : {})
  })
  const done = (patch: Partial<ChatSettings>): void => {
    setPicked('')
    void props.apply(patch)
  }
  return (
    <div className="field persona-row">
      <div className="preset-row">
        <select
          value={picked}
          aria-label="Apply a persona"
          onChange={(e) => {
            const p = personas.find((x) => x.id === e.target.value)
            if (p && !props.started) done(everything(p))
            else setPicked(e.target.value)
          }}
        >
          <option value="">{personas.length ? 'Apply a persona…' : 'No personas yet'}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => useStore.getState().setSettingsOpen(true, 'library')}>
          Library
        </button>
      </div>
      {persona && (
        <div className="persona-ways" role="group" aria-label={`Apply ${persona.name}`}>
          <button className="tw-btn tw-btn-sm" data-way="system" onClick={() => done({ systemPrompt: persona.systemPrompt, ...(persona.choiceCards ? { choiceCards: true } : {}) })}>
            Replace the system prompt
          </button>
          <button
            className="tw-btn tw-btn-sm"
            data-way="next"
            onClick={() => {
              const pending = props.settings.pendingInstruction.trim()
              done({ pendingInstruction: pending ? `${pending}\n\n${persona.systemPrompt}` : persona.systemPrompt })
            }}
          >
            Change from the next message
          </button>
          <span className="field-note">
            Replacing restarts the prompt cache for this chat{props.split ? ' pane' : ''}. A change from the next message keeps everything before it cached.
            Either way the model stays as it is.
          </span>
        </div>
      )}
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
  // Bumped when a persona is applied, so the prompt boxes below show what it put there.
  const [applied, setApplied] = useState(0)
  const applyPersona = async (patch: Partial<ChatSettings>): Promise<void> => {
    // Straight to the chat: a persona's model is for this chat, not the default for new ones.
    const view = await window.twilight.updateChatSettings(current.id, patch, shown)
    if (useStore.getState().current?.id === view.id) useStore.setState({ current: view })
    setApplied((n) => n + 1)
  }
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

  const [modelDefaults, setModelDefaults] = useState<ModelDefaults>({})
  useEffect(() => {
    void window.twilight.listPresets().then(setPresets)
    void window.twilight.listModelDefaults().then(setModelDefaults)
  }, [])
  const hasModelDefaults = !!modelDefaults[modelKey(settings.providerId, settings.modelId)]
  useEffect(() => setExtra(settings.extraParams), [settings.extraParams, shown])

  // A click anywhere outside closes the panel, unless it's pinned open (remembered). The header's
  // own Model settings button is left to toggle it.
  const panelRef = useRef<HTMLElement>(null)
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem('twilight.settingsPinned') === '1'
    } catch {
      return false
    }
  })
  const pin = (on: boolean): void => {
    setPinned(on)
    try {
      localStorage.setItem('twilight.settingsPinned', on ? '1' : '0')
    } catch {
      // Storage unavailable: the pin holds while the panel is open.
    }
  }
  useEffect(() => {
    if (pinned) return
    const down = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (!target?.isConnected || panelRef.current?.contains(target) || target.closest('.chat-head [aria-expanded]')) return
      onClose()
    }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [pinned, onClose])

  const defaultEffortLabel = options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'

  return (
    <section className="panel settings-panel" aria-label="Model settings" key={shown} ref={panelRef}>
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
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon panel-pin"
          aria-label={pinned ? 'Unpin: close when clicking outside' : 'Pin open'}
          title={pinned ? 'Pinned open. Click to close it when you click outside' : 'Keep open when clicking outside'}
          aria-pressed={pinned}
          onClick={() => pin(!pinned)}
        >
          <PinIcon size={14} />
        </button>
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

      <div className="model-defaults-row">
        <button
          className="tw-btn tw-btn-sm"
          title="Effort, thinking, temperature, max output tokens and extra request JSON. The system prompt stays with the chat."
          onClick={async () => setModelDefaults(await window.twilight.setModelDefaults(settings.providerId, settings.modelId, pickModelDefaults(settings)))}
        >
          {hasModelDefaults ? "Update this model's defaults" : "Save as this model's defaults"}
        </button>
        {hasModelDefaults && (
          <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={async () => setModelDefaults(await window.twilight.setModelDefaults(settings.providerId, settings.modelId, null))}>
            Clear
          </button>
        )}
        <span className="field-note">
          {hasModelDefaults
            ? `${modelName(models, settings.modelId)} starts with its saved settings whenever it's picked.`
            : `Whenever ${modelName(models, settings.modelId)} is picked, it starts with these settings. The system prompt stays with the chat.`}
        </span>
      </div>

      <PersonaRow settings={settings} started={current.started} split={!!current.split} apply={applyPersona} />

      {/* The system prompt itself lives with the chat: on the empty chat, and at the top of a started one. */}

      {current.started && (
        <label className="field">
          <span className="field-label">Change the instructions from the next message on</span>
          <textarea
            key={`${shown}-pending-${applied}`}
            className="pending-instruction"
            rows={3}
            defaultValue={settings.pendingInstruction}
            placeholder="For example: from now on, answer in Spanish."
            onBlur={(e) => e.currentTarget.value !== settings.pendingInstruction && void update({ pendingInstruction: e.currentTarget.value })}
          />
          <span className="field-note">
            Goes into your next message instead of the system prompt, so everything before it stays cached. The message shows it was there.
          </span>
        </label>
      )}

      <label className="check">
        <input type="checkbox" checked={settings.choiceCards} onChange={(e) => void update({ choiceCards: e.target.checked })} />
        Choice cards: the model can offer clickable options (text adventures)
      </label>
      {settings.choiceCards && (
        <div className="choice-settings" role="group" aria-label="How the model can offer choices">
          <label className="check">
            <input type="checkbox" checked={settings.choiceTool} onChange={(e) => void update({ choiceTool: e.target.checked })} />
            Tool call (present_choices)
          </label>
          <span className="field-note">
            The model calls a tool with the options as data; your pick goes back as its result. Needs a model with tool calling. Turning it on or off restarts the prompt cache once.
          </span>
          <label className="check">
            <input type="checkbox" checked={settings.choiceFenced} onChange={(e) => void update({ choiceFenced: e.target.checked })} />
            Choices blocks in the reply (```choices)
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.choicePlain} onChange={(e) => void update({ choicePlain: e.target.checked })} />
            Plain numbered options at the end of the reply
          </label>
          <span className="field-note">Read only under a title that asks (“What do you do?”, “Choices…”) or with a “Something else” option; other lists stay lists.</span>
          <label className="check">
            <input type="checkbox" checked={settings.choiceInstructions} onChange={(e) => void update({ choiceInstructions: e.target.checked })} />
            Add Twilight’s how-to to the system prompt
          </label>
          <span className="field-note">
            {settings.choiceTool
              ? 'Tells the model to use the tool. Turn off if your own prompt already does.'
              : settings.choiceFenced
                ? 'Tells the model to write a choices block. Turn off if your own prompt sets the format.'
                : 'Plain options follow your own prompt, so there’s nothing to add.'}
          </span>
        </div>
      )}

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
        inputStep={1}
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
