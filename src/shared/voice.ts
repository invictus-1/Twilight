// Offline voice: replies read aloud with Windows' own voices, and dictation transcribed on this PC
// by whisper.cpp. Nothing is sent anywhere; whisper.cpp and its model are fetched once, on request.

/** A whisper.cpp model Twilight offers, from ggerganov/whisper.cpp on Hugging Face. */
export interface VoiceModel {
  file: string
  label: string
  note: string
  /** Bytes. */
  size: number
  /** Understands languages other than English. */
  multilingual: boolean
}

export const VOICE_MODELS: VoiceModel[] = [
  { file: 'ggml-base.en.bin', label: 'Base (English)', note: 'Quick and light; good for clear speech.', size: 148_000_000, multilingual: false },
  { file: 'ggml-small.en.bin', label: 'Small (English)', note: 'More accurate, a little slower.', size: 488_000_000, multilingual: false },
  { file: 'ggml-large-v3-turbo-q5_0.bin', label: 'Large v3 Turbo', note: 'The most accurate, in any language; best with a recent processor.', size: 574_000_000, multilingual: true }
]

export interface VoiceState {
  /** Windows' installed voices, by name. */
  voices: string[]
  /** The voice replies are read in; null is Windows' default. */
  voice: string | null
  /** Speaking rate, -10 to 10 (0 is normal). */
  rate: number
  /** whisper.cpp, once fetched. */
  whisper: { version: string } | null
  /** Fetching whisper.cpp: bytes so far and in all. */
  installing: { done: number; total: number } | null
  models: (VoiceModel & { downloaded: boolean; downloading: { done: number; total: number } | null })[]
  /** The model dictation uses (a downloaded file name). */
  model: string | null
  /** 'en', or 'auto' to detect (multilingual models only). */
  language: 'en' | 'auto'
  error: string | null
}

/** Markdown as it should be heard: code and markup left out, links read as their words. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<details>[\s\S]*?<\/details>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Mono 16-bit PCM WAV at `rate` from float samples (-1 to 1): what whisper.cpp reads. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, s: string): void => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  out.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  text(36, 'data')
  out.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true))
  return new Uint8Array(out.buffer)
}

/** whisper.cpp's output, as plain text: timestamps, blank lines and sound markers left out. */
export function cleanTranscript(out: string): string {
  return out
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[^\]]*-->[^\]]*\]\s*/, '').trim())
    .filter((l) => l && !/^\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]$/i.test(l) && !/^\((music|silence|inaudible)[^)]*\)$/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
