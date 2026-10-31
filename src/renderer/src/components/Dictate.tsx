import { useEffect, useRef, useState } from 'react'
import { record, readAloud, useReadingOf, type Recording } from '../voice'
import { useStore } from '../store'
import { MicIcon, SpeakerIcon } from './Icons'

const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The microphone in the message box: press, speak, press again, and what you said goes in where
 * the caret is, transcribed on this PC. Until dictation is set up it opens Settings → Voice.
 */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'working'>('idle')
  const [secs, setSecs] = useState(0)
  const rec = useRef<Recording | null>(null)
  useEffect(() => () => rec.current?.cancel(), [])
  useEffect(() => {
    if (phase !== 'recording') return
    setSecs(0)
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const click = async (): Promise<void> => {
    const fail = (err: unknown, lead = ''): void => useStore.getState().setError(lead + clean(err))
    if (phase === 'working') return
    if (phase === 'recording') {
      setPhase('working')
      try {
        const wav = await rec.current!.stop()
        rec.current = null
        const text = await window.twilight.transcribe(wav)
        if (text) onText(text)
      } catch (err) {
        fail(err)
      } finally {
        setPhase('idle')
      }
      return
    }
    const state = await window.twilight.voiceState()
    if (!state.whisper || !state.model) return useStore.getState().setSettingsOpen(true, 'voice')
    try {
      rec.current = await record()
      setPhase('recording')
    } catch (err) {
      fail(err, 'The microphone could not be opened: ')
    }
  }

  const label = phase === 'recording' ? 'Stop and transcribe' : phase === 'working' ? 'Transcribing…' : 'Dictate'
  return (
    <button
      className={`tw-btn tw-btn-ghost tw-btn-icon dictate is-${phase}`}
      aria-pressed={phase === 'recording'}
      aria-label={label}
      title={phase === 'idle' ? 'Dictate: speak, then press again (transcribed on this PC)' : label}
      onClick={() => void click()}
    >
      {phase === 'working' ? <span className="tw-spin" /> : <MicIcon />}
      {phase === 'recording' && (
        <span className="dictate-time">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      )}
    </button>
  )
}

/** Reads a reply aloud in a Windows voice; pressed again, it stops. */
export function ReadAloudButton({ id, text }: { id: string; text: string }) {
  const state = useReadingOf(id)
  const on = state !== 'off'
  return (
    <button
      className={`tw-btn tw-btn-ghost tw-btn-icon read-aloud ${on ? 'is-reading' : ''}`}
      aria-label={on ? 'Stop reading' : 'Read aloud'}
      aria-pressed={on}
      title={on ? 'Stop reading' : 'Read aloud (a Windows voice, on this PC)'}
      onClick={() => void readAloud(id, text).catch((err) => useStore.getState().setError(clean(err)))}
    >
      {state === 'loading' ? <span className="tw-spin" /> : <SpeakerIcon />}
    </button>
  )
}
