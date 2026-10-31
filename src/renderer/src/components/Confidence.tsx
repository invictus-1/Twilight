import { useEffect, useRef, useState } from 'react'
import { heat, probability, type ReplyConfidence } from '@shared/confidence'
import type { NodeView } from '@shared/types'
import { useStore } from '../store'

// The confidence heatmap: a reply drawn token by token, warmer where the model was less sure.
// Click a word to see the ones it nearly wrote there; picking one starts a new version of the
// reply from that point, with the model carrying on after it.

const pct = (logprob: number): string => {
  const p = probability(logprob) * 100
  return p >= 99.5 ? '100%' : p < 1 ? '<1%' : `${Math.round(p)}%`
}

/** A token as it reads: spaces and line breaks made visible in the list of alternatives. */
const shown = (t: string): string => (t === '\n' || t === '\n\n' ? '↵' : t.trim() === '' ? '␣' : t)

export function ConfidenceView({ node }: { node: NodeView }) {
  const chatId = useStore((s) => s.current?.id)
  const [data, setData] = useState<ReplyConfidence | null | undefined>(undefined)
  const [open, setOpen] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chatId) return
    let live = true
    void window.twilight.replyConfidence(chatId, node.id).then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [chatId, node.id])

  // A click anywhere else, or Esc, closes the alternatives.
  useEffect(() => {
    if (open === null) return
    const away = (e: MouseEvent): void => {
      if (!(e.target as Element).closest?.('.conf-pop, .conf-tok')) setOpen(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (data === undefined) return <div className="msg-pending">Reading the probabilities…</div>
  if (!data) return <p className="field-note">No probabilities were kept for this reply.</p>
  const lead = node.text.slice(0, data.offset)
  const before = (i: number): string => lead + data.tokens.slice(0, i).map((t) => t.t).join('')
  const branch = (prefix: string): void => {
    setOpen(null)
    void useStore.getState().branchFromWord(node.id, prefix)
  }
  const unsure = data.tokens.filter((t) => heat(t.p) > 0).length

  return (
    <div className="conf-view" ref={box}>
      <p className="conf-legend field-note">
        Warmer words were less certain ({unsure.toLocaleString()} of {data.tokens.length.toLocaleString()} tokens under 90%). Click one for the words the model nearly wrote there.
      </p>
      <div className="conf-text">
        {lead && <span className="conf-lead" title="Kept from the version this one branched from">{lead}</span>}
        {data.tokens.map((t, i) => {
          const h = heat(t.p)
          return (
            <span key={i} className="conf-wrap">
              <span
                className={`conf-tok ${open === i ? 'is-open' : ''}`}
                data-i={i}
                style={h ? { background: `color-mix(in srgb, var(--danger) ${Math.round(8 + h * 42)}%, transparent)` } : undefined}
                title={`${pct(t.p)} sure`}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {t.t}
              </span>
              {open === i && (
                <span className="conf-pop" role="dialog" aria-label="Words the model nearly wrote">
                  <span className="conf-pop-row is-chosen">
                    <span className="conf-pop-word">{shown(t.t)}</span>
                    <span className="conf-pop-pct">{pct(t.p)}</span>
                    <button className="tw-btn tw-btn-ghost tw-btn-sm conf-keep" title="A new version that keeps the reply up to this word and writes on from it" onClick={() => branch(before(i + 1))}>
                      Write on from here
                    </button>
                  </span>
                  {t.alt.length === 0 && <span className="field-note">No other words came close.</span>}
                  {t.alt.map(([word, lp]) => (
                    <button key={word} className="conf-pop-row conf-alt" data-word={word} title="A new version with this word here instead" onClick={() => branch(before(i) + word)}>
                      <span className="conf-pop-word">{shown(word)}</span>
                      <span className="conf-pop-pct">{pct(lp)}</span>
                    </button>
                  ))}
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
