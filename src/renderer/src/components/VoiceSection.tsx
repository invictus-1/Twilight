import { useEffect, useState } from 'react'
import { sizeLabel } from '@shared/localModels'
import type { VoiceState } from '@shared/voice'
import { readAloud, stopReading, useReading } from '../voice'
import { useStore } from '../store'
import { MicIcon, SpeakerIcon } from './Icons'

// Settings → Voice: the voice replies are read in, and whisper.cpp with a speech model for
// dictation. Both run on this PC; only fetching whisper.cpp and a model touches the network.

const api = window.twilight
const SAMPLE = 'The lamps came on along the harbour one by one, and the ferry turned for home.'
const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Progress({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, (done / Math.max(1, total)) * 100)
  return (
    <div className="library-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function VoiceSection() {
  const [state, setState] = useState<VoiceState | null>(null)
  const reading = useReading()
  useEffect(() => {
    void api.voiceState().then(setState)
    return api.onVoice(setState)
  }, [])
  if (!state) return <p className="field-note local-reading">Reading this PC's voices…</p>
  const set = (patch: Parameters<typeof api.setVoiceSettings>[0]): void => void api.setVoiceSettings(patch).then(setState)
  const chosen = state.models.find((m) => m.file === state.model)
  const tryVoice = (): void => {
    void readAloud('voice-sample', SAMPLE).catch((err) => useStore.getState().setError(clean(err)))
  }

  return (
    <>
      <div className="settings-card voice-read">
        <h3 className="t-heading">Reading aloud</h3>
        <p className="field-note">The speaker button on a reply reads it in one of the voices Windows already has. Code and markup are skipped.</p>
        {state.voices.length === 0 ? (
          <p className="field-note">Windows didn't list any voices. Add one in Windows Settings → Time and language → Speech.</p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Voice</span>
              <select className="voice-pick" value={state.voice ?? ''} onChange={(e) => set({ voice: e.target.value || null })}>
                <option value="">Windows' default</option>
                {state.voices.map((v) => (
                  <option key={v} value={v}>
                    {v.replace(/^Microsoft /, '').replace(/ Desktop$/, '')}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Speed</span>
              <input type="range" className="voice-rate" min={-5} max={5} step={1} value={state.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
              <span className="field-note">{state.rate === 0 ? 'Normal' : state.rate > 0 ? `Faster (+${state.rate})` : `Slower (${state.rate})`}</span>
            </label>
            <div className="data-actions">
              <button className="tw-btn tw-btn-sm voice-try" onClick={() => (reading.id === 'voice-sample' ? stopReading() : tryVoice())}>
                <SpeakerIcon size={14} />
                {reading.id === 'voice-sample' ? (reading.loading ? 'Getting ready…' : 'Stop') : 'Try it'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="settings-card voice-dictate">
        <h3 className="t-heading">Dictation</h3>
        <p className="field-note">
          The microphone button in the message box records you, and whisper.cpp turns it into text on this PC. It's fetched from its official releases on GitHub (about 9 MB), with a
          speech model from Hugging Face.
        </p>
        {state.installing ? (
          <>
            <p className="field-note" aria-live="polite">
              Getting whisper.cpp: {sizeLabel(state.installing.done)} of {sizeLabel(state.installing.total)}…
            </p>
            <Progress done={state.installing.done} total={state.installing.total} />
          </>
        ) : !state.whisper ? (
          <div className="data-actions">
            <button className="tw-btn tw-btn-sm voice-install" onClick={() => void api.installWhisper()}>
              Get whisper.cpp
            </button>
          </div>
        ) : (
          <p className="local-engine-status">
            <span className="local-dot is-on" />
            whisper.cpp {state.whisper.version}
          </p>
        )}

        <h4 className="settings-section">Speech model</h4>
        <div className="voice-models">
          {state.models.map((m) => (
            <div key={m.file} className={`voice-model ${state.model === m.file ? 'is-chosen' : ''}`} data-file={m.file}>
              <div className="local-starter-text">
                <span className="local-starter-name">
                  {m.label} <span className="field-note">· {sizeLabel(m.size)}</span>
                </span>
                <span className="field-note">{m.note}</span>
                {m.downloading && <Progress done={m.downloading.done} total={m.downloading.total} />}
              </div>
              {m.downloading ? (
                <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void api.cancelVoiceModel(m.file)}>
                  Cancel
                </button>
              ) : !m.downloaded ? (
                <button className="tw-btn tw-btn-sm voice-download" onClick={() => void api.downloadVoiceModel(m.file)}>
                  Download
                </button>
              ) : state.model === m.file ? (
                <span className="field-note voice-in-use">In use</span>
              ) : (
                <button className="tw-btn tw-btn-ghost tw-btn-sm voice-use" onClick={() => set({ model: m.file })}>
                  Use
                </button>
              )}
            </div>
          ))}
        </div>
        {chosen?.multilingual && (
          <label className="field">
            <span className="field-label">Language</span>
            <select value={state.language} onChange={(e) => set({ language: e.target.value as VoiceState['language'] })}>
              <option value="en">English</option>
              <option value="auto">Whatever I speak</option>
            </select>
          </label>
        )}
        {state.whisper && chosen && (
          <p className="field-note voice-ready">
            <MicIcon size={13} /> Ready: press the microphone in the message box, speak, and press it again.
          </p>
        )}
        {state.error && <p className="form-error">{state.error}</p>}
      </div>
    </>
  )
}
