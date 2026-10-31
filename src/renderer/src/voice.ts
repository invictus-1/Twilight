import { useSyncExternalStore } from 'react'
import { encodeWav, speakable } from '@shared/voice'

// Offline voice in the window: one reply read aloud at a time, and the microphone recorded for
// dictation. The speech itself is made and transcribed in the main process (main/voice.ts).

interface Reading {
  /** The reply being read, or null. */
  id: string | null
  /** Its speech is still being made. */
  loading: boolean
}

let reading: Reading = { id: null, loading: false }
let audio: HTMLAudioElement | null = null
let url: string | null = null
const listeners = new Set<() => void>()
const set = (next: Reading): void => {
  reading = next
  listeners.forEach((l) => l())
}

export function useReading(): Reading {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => reading
  )
}

export function stopReading(): void {
  audio?.pause()
  audio = null
  if (url) URL.revokeObjectURL(url)
  url = null
  set({ id: null, loading: false })
}

/** Reads a reply aloud; the same reply again stops it. */
export async function readAloud(id: string, markdown: string): Promise<void> {
  if (reading.id === id) return stopReading()
  stopReading()
  set({ id, loading: true })
  try {
    const bytes = await window.twilight.speak(speakable(markdown))
    if (reading.id !== id) return
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }))
    audio = new Audio(url)
    audio.onended = () => reading.id === id && stopReading()
    await audio.play()
    set({ id, loading: false })
  } catch (err) {
    if (reading.id === id) stopReading()
    throw err
  }
}

const RATE = 16_000

/** A recording in progress; stop() ends it and gives the speech as a 16 kHz WAV. */
export interface Recording {
  stop(): Promise<Uint8Array>
  cancel(): void
}

export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  // The context resamples to whisper's rate, so what's kept is ready to send.
  const ctx = new AudioContext({ sampleRate: RATE })
  const source = ctx.createMediaStreamSource(stream)
  const tap = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  tap.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  source.connect(tap)
  tap.connect(ctx.destination)
  const end = async (): Promise<void> => {
    tap.disconnect()
    source.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close().catch(() => undefined)
  }
  return {
    async stop() {
      await end()
      const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) {
        samples.set(c, at)
        at += c.length
      }
      return encodeWav(samples, RATE)
    },
    cancel: () => void end()
  }
}
