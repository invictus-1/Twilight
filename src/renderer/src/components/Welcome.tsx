import { useEffect, useMemo, useState } from 'react'
import type { ProviderConfig } from '@shared/types'
import { useStore } from '../store'
import { savedTheme, setTheme, type Theme } from '../theme'
import { useWriting } from '../writingStore'
import { CheckIcon, ChipIcon, CloudIcon, FolderIcon, SparkIcon } from './Icons'

// The first-run welcome: an evening falling over the window, then four short steps (connect a
// model, choose a writing folder, pick a look, done). Every step can be skipped; closing it marks
// the welcome as seen, and Settings → About plays it again.

type Step = 'intro' | 'model' | 'folder' | 'look' | 'done'
const STEPS: Step[] = ['intro', 'model', 'folder', 'look', 'done']

const OPENROUTER: ProviderConfig = { id: 'openrouter', kind: 'openai', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: true, shownModels: [] }
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Sky({ settled }: { settled: boolean }) {
  // Stars at fixed, scattered places (the same every time), twinkling out of step.
  const stars = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 61.3) % 62, d: (i % 7) * 0.6, s: i % 5 === 0 ? 3 : 2 })),
    []
  )
  return (
    <div className={`wl-sky ${settled ? 'settled' : ''}`} aria-hidden="true">
      {stars.map((st, i) => (
        <span key={i} className="wl-star" style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, animationDelay: `${st.d}s` }} />
      ))}
      <span className="wl-sun" />
      <span className="wl-band wl-band-1" />
      <span className="wl-band wl-band-2" />
      <span className="wl-band wl-band-3" />
      <span className="wl-band wl-band-4" />
    </div>
  )
}

/** Connect a model: Claude, OpenRouter or a local server, then choose which models the picker shows. */
function ModelStep() {
  const providers = useStore((s) => s.providers)
  const models = useStore((s) => s.models)
  const [kind, setKind] = useState<'anthropic' | 'openrouter' | 'local'>('anthropic')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const providerId = kind === 'anthropic' ? 'anthropic' : kind === 'openrouter' ? 'openrouter' : null
  const local = providers.filter((p) => p.kind === 'openai' && /localhost|127\.0\.0\.1/.test(p.baseUrl ?? ''))
  const connected = kind === 'local' ? local.filter((p) => p.status?.ok) : providers.filter((p) => p.id === providerId && p.status?.ok)
  const available = models.filter((m) => connected.some((p) => p.id === m.providerId) && !m.custom)

  const refresh = async (): Promise<void> => {
    await useStore.getState().refreshModels(true)
    useStore.getState().setProviders(await window.twilight.listProviders())
  }
  const connect = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      if (kind === 'local') {
        await refresh()
        const found = useStore.getState().providers.filter((p) => p.kind === 'openai' && /localhost|127\.0\.0\.1/.test(p.baseUrl ?? '') && p.status?.ok)
        setMessage(found.length ? { ok: true, text: `Found ${found.map((p) => p.name).join(' and ')}.` } : { ok: false, text: 'No local server answered. Start LM Studio or Ollama (with a model loaded), then look again.' })
      } else {
        const existing = providers.find((p) => p.id === providerId)
        const config = existing ?? OPENROUTER
        useStore.getState().setProviders(await window.twilight.saveProvider({ ...config, enabled: true }, key))
        const status = await window.twilight.testProvider(config.id)
        await refresh()
        setMessage({ ok: status.ok, text: status.message })
        if (status.ok) setKey('')
      }
    } catch (err) {
      setMessage({ ok: false, text: errText(err) })
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (providerId: string, modelId: string, show: boolean): Promise<void> => {
    const p = useStore.getState().providers.find((x) => x.id === providerId)
    if (!p) return
    const shown = new Set(p.shownModels ?? [])
    if (show) shown.add(modelId)
    else shown.delete(modelId)
    useStore.getState().setProviders(await window.twilight.saveProvider({ ...p, shownModels: [...shown], hiddenModels: undefined }))
    await useStore.getState().refreshModels(true)
    // The first model you pick becomes the one new chats start with.
    if (show && !models.some((m) => !m.hidden)) await useStore.getState().setDefaultModel(providerId, modelId)
  }

  return (
    <div className="wl-step">
      <h2 className="wl-title">Connect a model</h2>
      <p className="wl-sub">Twilight talks to the models you choose, with your own keys. Keys are encrypted on this computer and only ever sent to their provider.</p>
      <div className="wl-choices" role="radiogroup" aria-label="Where your models come from">
        {(
          [
            ['anthropic', <CloudIcon key="i" />, 'Claude', 'An API key from console.anthropic.com'],
            ['openrouter', <SparkIcon key="i" />, 'OpenRouter', 'One key for hundreds of models'],
            ['local', <ChipIcon key="i" />, 'On this computer', 'LM Studio, Ollama or llama.cpp']
          ] as const
        ).map(([id, icon, name, note]) => (
          <button
            key={id}
            role="radio"
            aria-checked={kind === id}
            className="wl-choice"
            onClick={() => {
              setKind(id)
              setMessage(null)
            }}
          >
            <span className="wl-choice-icon">{icon}</span>
            <b>{name}</b>
            <small>{note}</small>
          </button>
        ))}
      </div>
      <div className="wl-connect">
        {kind !== 'local' && (
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={kind === 'anthropic' ? 'Paste your Anthropic API key (sk-ant-api…)' : 'Paste your OpenRouter key (sk-or-…)'}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && key.trim() && void connect()}
          />
        )}
        <button className="tw-btn tw-btn-primary" disabled={busy || (kind !== 'local' && !key.trim())} onClick={() => void connect()}>
          {busy ? 'Connecting…' : kind === 'local' ? 'Look for local servers' : 'Connect'}
        </button>
      </div>
      {message && <p className={`wl-status ${message.ok ? 'ok' : 'bad'}`}>{message.ok && <CheckIcon size={14} />}{message.text}</p>}
      {available.length > 0 && (
        <div className="wl-models">
          <span className="wl-label">Tick the models you want in the picker (you can change this any time in Settings).</span>
          <div className="wl-model-grid">
            {available.slice(0, 12).map((m) => (
              <label key={`${m.providerId}:${m.id}`} className="wl-model">
                <input type="checkbox" checked={!m.hidden} onChange={(e) => void toggle(m.providerId, m.id, e.target.checked)} />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FolderStep() {
  const [folder, setFolder] = useState<string>('')
  useEffect(() => void window.twilight.getWritingFolder().then(setFolder), [])
  return (
    <div className="wl-step">
      <h2 className="wl-title">Where your writing lives</h2>
      <p className="wl-sub">Documents are plain markdown files in a folder you choose. An Obsidian vault works as is, and both apps can edit the same files. Writer insights reads this folder too.</p>
      <div className="wl-folder">
        <FolderIcon size={18} />
        <span className="wl-folder-path" title={folder}>
          {folder || '…'}
        </span>
        <button
          className="tw-btn"
          onClick={async () => {
            const chosen = await window.twilight.chooseWritingFolder()
            if (chosen) {
              setFolder(chosen)
              void useWriting.getState().refresh()
            }
          }}
        >
          Choose a folder…
        </button>
      </div>
    </div>
  )
}

function LookStep() {
  const [theme, setThemeState] = useState<Theme>(savedTheme)
  const pick = (t: Theme): void => {
    setTheme(t)
    setThemeState(t)
  }
  return (
    <div className="wl-step">
      <h2 className="wl-title">Pick a look</h2>
      <p className="wl-sub">Both are dark and easy on the eyes at night. Switch whenever you like in Settings → General.</p>
      <div className="theme-picker wl-themes" role="group" aria-label="Theme">
        <button className="theme-option" aria-pressed={theme === 'twilight'} onClick={() => pick('twilight')}>
          <span className="theme-swatch" style={{ background: 'linear-gradient(180deg, #171a3d, #3a2245)' }}>
            <span style={{ background: '#9497ff' }} />
            <span style={{ background: '#c4a0ff' }} />
            <span style={{ background: '#ffb48a' }} />
          </span>
          <b>Twilight</b>
          <small>Blue dusk, iris and a warm horizon.</small>
        </button>
        <button className="theme-option" aria-pressed={theme === 'ultraviolet'} onClick={() => pick('ultraviolet')}>
          <span className="theme-swatch" style={{ background: 'radial-gradient(circle at 80% 0%, #2a1245, #0c0614 70%)' }}>
            <span style={{ background: '#b07cff' }} />
            <span style={{ background: '#f07cff' }} />
            <span style={{ background: '#ff8fc8' }} />
          </span>
          <b>Ultraviolet</b>
          <small>Deep violet with magenta and pink.</small>
        </button>
      </div>
    </div>
  )
}

const TIPS: [string, string][] = [
  ['Ctrl+N', 'A new chat. Pick its model at the bottom right.'],
  ['Split', 'Compare two models side by side from the same point in a chat.'],
  ['Writing', 'Your manuscripts, with Ask, Rewrite and Tighten on any selection.'],
  ['Insights', 'Words written, streaks, characters and story analysis.']
]

export function Welcome() {
  const [step, setStep] = useState<Step>('intro')
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 2200)
    return () => clearTimeout(t)
  }, [])
  const index = STEPS.indexOf(step)
  const close = (): void => useStore.getState().setWelcomeOpen(false)
  const go = (delta: number): void => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, index + delta))])

  return (
    <div className={`welcome ${step === 'intro' ? 'is-intro' : ''}`} role="dialog" aria-modal="true" aria-label="Welcome to Twilight">
      <div className="wl-drag drag" />
      <Sky settled={settled || step !== 'intro'} />
      {step === 'intro' ? (
        <div className="wl-intro">
          <span className="wl-eyebrow">Welcome to</span>
          <h1 className="wl-wordmark">Twilight</h1>
          <p className="wl-tagline">A quiet place to write with language models.</p>
          <div className="wl-intro-actions">
            <button className="tw-btn tw-btn-primary wl-begin" onClick={() => go(1)}>
              Begin
            </button>
            <button className="link-btn wl-skip" onClick={close}>
              Skip setup
            </button>
          </div>
        </div>
      ) : (
        <div className="wl-panel" key={step}>
          {step === 'model' && <ModelStep />}
          {step === 'folder' && <FolderStep />}
          {step === 'look' && <LookStep />}
          {step === 'done' && (
            <div className="wl-step">
              <h2 className="wl-title">You're all set</h2>
              <p className="wl-sub">A few places to start. Everything else is in Settings, and the Roadmap there shows what's coming.</p>
              <div className="wl-tips">
                {TIPS.map(([k, t]) => (
                  <div key={k} className="wl-tip">
                    <b>{k}</b>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <footer className="wl-foot">
            <div className="wl-dots" aria-label={`Step ${index} of ${STEPS.length - 1}`}>
              {STEPS.slice(1).map((s) => (
                <span key={s} className={s === step ? 'on' : STEPS.indexOf(s) < index ? 'done' : ''} />
              ))}
            </div>
            <span className="tw-spacer" />
            {step !== 'done' && (
              <button className="tw-btn tw-btn-ghost" onClick={close}>
                Skip the rest
              </button>
            )}
            <button className="tw-btn tw-btn-ghost" onClick={() => go(-1)}>
              Back
            </button>
            {step === 'done' ? (
              <button className="tw-btn tw-btn-primary" onClick={close}>
                Start writing
              </button>
            ) : (
              <button className="tw-btn tw-btn-primary" onClick={() => go(1)}>
                Next
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}
