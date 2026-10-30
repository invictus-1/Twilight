import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { attachmentKind, formatBytes, tooBig } from '@shared/attachments'
import { costOf, formatCost, formatTokens } from '@shared/pricing'
import type { Attachment, SendTarget } from '@shared/types'
import { useStore } from '../store'
import { CloseIcon, DocIcon, PaperclipIcon, SendIcon, SlidersIcon, StopIcon } from './Icons'
import { DocPicker } from './DocPicker'
import { ModelPicker } from './ModelPicker'
import { PromptPicker } from './PromptPicker'
import { Hint, ToolsMenu } from './ToolsMenu'

const MAX_LINES = 12
const LINE = 22

const TARGETS: { value: SendTarget; label: string; hint: string }[] = [
  { value: 'a', label: 'A', hint: 'Alt+1' },
  { value: 'b', label: 'B', hint: 'Alt+2' },
  { value: 'both', label: 'Both', hint: 'Alt+3' }
]

const PLACEHOLDER: Record<SendTarget, string> = { a: 'Message A', b: 'Message B', both: 'Message both panes' }

/** A dropped or pasted file as an attachment: text read as text, images and PDFs as base64. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  // A pasted screenshot arrives as "image.png"; give it a name worth keeping.
  const name = file.name && file.name !== 'image.png' ? file.name : `Pasted image ${new Date().toLocaleTimeString().replace(/[:\s]/g, '-')}.png`
  const { kind, mediaType } = attachmentKind(name, file.type)
  const big = tooBig(kind, file.size, name)
  if (big) throw new Error(big)
  if (kind === 'text') {
    const text = await file.text()
    if (text.includes('\u0000')) throw new Error(`${name} isn't a text file. Text, images (PNG, JPEG, GIF, WebP) and PDFs can be attached.`)
    return { name, text }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name, text: '', kind, mediaType, data: btoa(binary) }
}

/** Below this many tokens a message isn't worth a word about its size. */
const BIG_SEND = 8000

/**
 * What a big message costs to send, before you send it: its tokens (about four characters each)
 * and, with a price for the model, what they cost going in. With the cache on they're written to
 * it once (at the cache-write price) and read cheaply after.
 */
function SendSize({ text, attachments }: { text: string; attachments: Attachment[] }) {
  const settings = useStore((s) => s.current?.settings ?? s.defaults)
  const models = useStore((s) => s.models)
  const tokens = Math.round((text.length + attachments.reduce((n, a) => n + a.text.length, 0)) / 4)
  if (!settings || tokens < BIG_SEND) return null
  const local = models.find((m) => m.id === settings.modelId && m.providerId === settings.providerId)?.local ?? false
  const usage = { input: settings.caching ? 0 : tokens, cacheWrite: settings.caching ? tokens : 0, cacheRead: 0, output: 0, ms: 0, cacheTtl: settings.cacheTtl }
  const cost = local ? null : costOf(settings.modelId, usage, false)
  return (
    <div className="send-size" title="An estimate from the length of what's in the box and attached; the model counts exactly">
      ~{formatTokens(tokens)} tokens to send
      {cost !== null && <> · about {formatCost(cost)}{settings.caching ? ' the first time, then cached' : ''}</>}
    </div>
  )
}

const chipSize = (a: Attachment): string => (a.data ? formatBytes(Math.floor((a.data.length * 3) / 4)) : `~${formatTokens(Math.round(a.text.length / 4))}`)

/**
 * What you'd typed and attached but not sent. It outlives the message box, so going to another
 * section or Settings and back finds it as you left it; the text is kept across restarts too.
 */
const DRAFT_KEY = 'twilight.draft'
const unsent: { text: string; attachments: Attachment[] } = {
  text: (() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? ''
    } catch {
      return ''
    }
  })(),
  attachments: []
}
const keepDraft = (): void => {
  try {
    if (unsent.text) localStorage.setItem(DRAFT_KEY, unsent.text)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Storage unavailable: the draft still holds while Twilight is open.
  }
}
window.addEventListener('beforeunload', keepDraft)

export function Composer() {
  const [text, setText] = useState(() => unsent.text)
  const [attachments, setAttachments] = useState<Attachment[]>(() => unsent.attachments)
  // Kept as it changes (cheap), written to storage only when the box is put away or the app closes.
  unsent.text = text
  unsent.attachments = attachments
  useEffect(() => keepDraft, [])
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const split = useStore((s) => !!s.current?.split)
  const target = useStore((s) => (s.current?.split ? s.target : 'a'))
  const streaming = useStore((s) => {
    const c = s.current
    if (!c) return false
    const a = c.path.at(-1)?.status === 'streaming'
    const b = c.split?.path.at(-1)?.status === 'streaming'
    return target === 'a' ? a : target === 'b' ? b : a || b
  })
  const send = useStore((s) => s.send)
  const stop = useStore((s) => s.stop)
  const currentId = useStore((s) => s.current?.id)
  const choiceCards = useStore((s) => s.current?.settings.choiceCards ?? false)
  const pendingA = useStore((s) => s.current?.settings.pendingInstruction ?? '')
  const pendingB = useStore((s) => s.current?.split?.settings.pendingInstruction ?? '')
  const pending = (target === 'b' ? pendingB : target === 'both' ? pendingA || pendingB : pendingA).trim()

  // Grow with the text up to MAX_LINES, then scroll.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES * LINE + 8)}px`
  }, [text])

  useLayoutEffect(() => area.current?.focus(), [currentId])

  const submit = (): void => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || streaming) return
    setText('')
    setAttachments([])
    void send(value, attachments)
  }

  /** Puts a saved prompt where the caret is (over any selection), for you to send or change. */
  const insert = (snippet: string): void => {
    const el = area.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    // A prompt put after (or before) words you typed keeps a space between them.
    const before = text.slice(0, start)
    const after = text.slice(end)
    const piece = `${before && !/\s$/.test(before) ? ' ' : ''}${snippet}${after && !/^\s/.test(after) ? ' ' : ''}`
    setText(before + piece + after)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + piece.length, start + piece.length)
    })
  }

  const addFiles = async (files: File[]): Promise<void> => {
    try {
      const added = await Promise.all(files.map(fileToAttachment))
      if (added.length) setAttachments((list) => [...list, ...added])
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message : String(err))
    }
    area.current?.focus()
  }

  const attach = async (): Promise<void> => {
    try {
      const picked = await window.twilight.pickAttachments()
      if (picked.length) setAttachments((list) => [...list, ...picked])
    } catch (err) {
      useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
    area.current?.focus()
  }

  return (
    <div className={`composer-wrap ${split ? 'composer-split' : ''}`}>
      <div
        className={`tw-composer ${dragging ? 'tw-composer-drop' : ''}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragging(true)
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDragging(false)
          void addFiles([...e.dataTransfer.files])
        }}
      >
        {dragging && <div className="drop-hint">Drop to attach: text, images and PDFs</div>}
        {pending && (
          <div className="pending-chip" title={pending}>
            <SlidersIcon size={13} />
            <span>Instruction change goes with this message: {pending}</span>
            <button
              className="attach-remove"
              aria-label="Drop the instruction change"
              onClick={() => {
                const s = useStore.getState()
                if (target !== 'b') void s.updateSettings({ pendingInstruction: '' }, 'a')
                if (target !== 'a' && split) void s.updateSettings({ pendingInstruction: '' }, 'b')
              }}
            >
              <CloseIcon size={11} />
            </button>
          </div>
        )}
        <SendSize text={text} attachments={attachments} />
        {attachments.length > 0 && (
          <div className="tw-attach">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className={`tw-badge attach-chip ${a.kind === 'image' ? 'attach-image' : ''}`}
                title={a.kind === 'image' ? 'Sent as an image' : a.kind === 'pdf' ? 'Sent as a PDF: pages are read as text and images' : `${a.text.length.toLocaleString()} characters, sent in full`}
              >
                {a.kind === 'image' && a.data ? (
                  <img className="attach-thumb" src={`data:${a.mediaType};base64,${a.data}`} alt="" />
                ) : a.kind === 'pdf' ? (
                  <DocIcon size={13} />
                ) : (
                  <PaperclipIcon size={13} />
                )}
                {a.name}
                <span className="attach-size">{chipSize(a)}</span>
                <button
                  className="attach-remove"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={split ? 1 : 2}
          value={text}
          placeholder={split ? PLACEHOLDER[target] : 'Ask anything'}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (!files.length) return
            e.preventDefault()
            void addFiles(files)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="tw-composer-bar">
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Attach files" title="Attach files: text, images or PDFs (or drop them here, or paste a screenshot)" onClick={() => void attach()}>
            <PaperclipIcon />
          </button>
          <DocPicker
            onPick={(a) => {
              setAttachments((list) => [...list, a])
              area.current?.focus()
            }}
          />
          <PromptPicker onInsert={insert} />
          {currentId && <ToolsMenu />}
          {currentId && (
            <Hint
              title={choiceCards ? 'Choice cards: on' : 'Choice cards: off'}
              text="When the story reaches a decision, the model's options become a card you can click, edit, or answer in your own words. How the options arrive (a tool call, a choices block, or plain numbered text) is set in Tools."
            >
              <button
                className="tw-btn tw-btn-ghost tw-btn-sm tw-toggle"
                aria-pressed={choiceCards}
                aria-label="Choice cards"
                onClick={() => {
                  const s = useStore.getState()
                  void s.updateSettings({ choiceCards: !choiceCards }, 'a')
                  if (split) void s.updateSettings({ choiceCards: !choiceCards }, 'b')
                }}
              >
                Choices
              </button>
            </Hint>
          )}
          {split && (
            <div className="tw-seg" role="group" aria-label="Send to">
              {TARGETS.map((t) => (
                <button
                  key={t.value}
                  className={t.value === 'a' ? 'tw-seg-a' : t.value === 'b' ? 'tw-seg-b' : undefined}
                  aria-pressed={target === t.value}
                  title={`Send to ${t.label} (${t.hint})`}
                  onClick={() => useStore.getState().setTarget(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <span className="tw-spacer" />
          {!split && <ModelPicker />}
          {streaming ? (
            <button className="tw-send" aria-label="Stop (Esc)" title="Stop (Esc)" onClick={() => void stop(target)}>
              <StopIcon />
            </button>
          ) : (
            <button
              className="tw-send"
              aria-label="Send (Enter)"
              title="Send (Enter)"
              disabled={!text.trim() && attachments.length === 0}
              onClick={submit}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
