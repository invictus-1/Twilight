import { useState, useSyncExternalStore } from 'react'
import { computeVerdict, ELO_K, ELO_START, MAX_PASSAGES, passageLetter, roundPairs, type JudgeInput, type Judgment, type Rubric, type RubricCriterion } from '@shared/judge'
import { formatTokens } from '@shared/pricing'
import { useJudge } from '../judgeStore'
import { renderMarkdown, renderMarkdownLive } from '../markdown'
import { modelName, optionsFor, useStore } from '../store'
import { readStream, subscribeStream } from '../stream'
import { CloseIcon, PaperclipIcon, PlusIcon, SidebarIcon, TrashIcon, TrophyIcon } from './Icons'
import { ArenaBoard } from './Arena'

const words = (s: string): number => s.match(/\S+/g)?.length ?? 0
const fmt = (n: number | null): string => (n === null ? '–' : n.toFixed(1))

async function pickText(): Promise<{ name: string; text: string }[]> {
  try {
    return await window.twilight.pickAttachments()
  } catch (err) {
    useJudge.setState({ error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) })
    return []
  }
}

// ——— Setting up a comparison ———

/** Every passage in the draft, A and B first, then any added for a round. */
const draftPassages = (d: JudgeInput): { passage: string; label: string }[] => [
  { passage: d.passageA, label: d.labelA },
  { passage: d.passageB, label: d.labelB },
  ...(d.morePassages ?? [])
]

function PassageInput({ index }: { index: number }) {
  const draft = useJudge((s) => s.draft)!
  const update = useJudge((s) => s.updateDraft)
  const side = passageLetter(index)
  const { passage: text, label } = draftPassages(draft)[index]
  const set = (patch: { passage?: string; label?: string }): void => {
    if (index === 0) update({ ...(patch.passage !== undefined && { passageA: patch.passage }), ...(patch.label !== undefined && { labelA: patch.label }) })
    else if (index === 1) update({ ...(patch.passage !== undefined && { passageB: patch.passage }), ...(patch.label !== undefined && { labelB: patch.label }) })
    else {
      // Read the list fresh: a file load sets text and label in one go, after an await.
      const latest = useJudge.getState().draft?.morePassages ?? []
      update({ morePassages: latest.map((p, j) => (j === index - 2 ? { ...p, ...patch } : p)) })
    }
  }
  return (
    <section className={`judge-passage judge-passage-${index < 2 ? side.toLowerCase() : 'more'}`} data-passage={side}>
      <header className="judge-passage-head">
        <span className="tw-pane-tag">{side}</span>
        <input className="judge-label" value={label} placeholder="Who wrote it (hidden from the judge)" onChange={(e) => set({ label: e.target.value })} />
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label={`Load passage ${side} from a file`}
          title="Load from a file"
          onClick={async () => {
            const [file] = await pickText()
            if (file) set({ passage: file.text, label: label || file.name })
          }}
        >
          <PaperclipIcon />
        </button>
        {index >= 2 && (
          <button
            className="tw-btn tw-btn-ghost tw-btn-icon judge-passage-remove"
            aria-label={`Remove passage ${side}`}
            title="Remove this passage"
            onClick={() => update({ morePassages: (draft.morePassages ?? []).filter((_, j) => j !== index - 2) })}
          >
            <CloseIcon />
          </button>
        )}
      </header>
      <textarea value={text} placeholder={`Paste passage ${side}`} onChange={(e) => set({ passage: e.target.value })} />
      <span className="field-note">{words(text).toLocaleString()} words</span>
    </section>
  )
}

function JudgeForm() {
  const draft = useJudge((s) => s.draft)!
  const rubrics = useJudge((s) => s.rubrics)
  const update = useJudge((s) => s.updateDraft)
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const folders = useStore((s) => s.folders)
  const [editing, setEditing] = useState<Rubric | null>(null)
  const options = optionsFor(models, providers, draft.judgeProviderId, draft.judgeModelId)
  const rubric = rubrics.find((r) => r.id === draft.rubricId) ?? rubrics[0]
  const contextChars = draft.contextDocs.reduce((n, d) => n + d.text.length, 0) + draft.systemPrompt.length + draft.authorPrompt.length
  const passages = draftPassages(draft)
  const ready = passages.every((p) => p.passage.trim())
  const round = passages.length > 2
  const pairs = roundPairs(passages.length).length
  const runs = pairs * (draft.bothOrders ? 2 : 1)
  const labels = passages.map((p) => p.label.trim())
  const unlabelled = labels.some((l) => !l)
  const repeated = labels.find((l, i) => l && labels.indexOf(l) !== i)

  return (
    <div className="judge-form">
      <label className="field">
        <span className="field-label">Title</span>
        <input value={draft.title} placeholder="e.g. Chapter 7 opening — Opus 5.5 vs Sonnet 5.5" onChange={(e) => update({ title: e.target.value })} />
      </label>

      <div className="judge-passages">
        {passages.map((_, i) => (
          <PassageInput key={i} index={i} />
        ))}
      </div>
      <div className="judge-add-row">
        {passages.length < MAX_PASSAGES && (
          <button className="tw-btn tw-btn-sm judge-add-passage" onClick={() => update({ morePassages: [...(draft.morePassages ?? []), { passage: '', label: '' }] })}>
            <PlusIcon size={14} />
            Add a passage
          </button>
        )}
        <span className="field-note">
          {round
            ? `A round: each of the ${pairs} pairs is judged blind as its own comparison, and the round gets its own leaderboard.${unlabelled ? ' Unlabelled passages are left out of the leaderboard.' : ''}`
            : `Add more passages, up to ${MAX_PASSAGES}, to judge every pair and rank them.`}
        </span>
      </div>

      <h3 className="settings-section">{round ? 'What the passages were written from' : 'What both passages were written from'}</h3>
      <label className="field">
        <span className="field-label">Author prompt</span>
        <textarea rows={3} value={draft.authorPrompt} placeholder="The prompt both models answered" onChange={(e) => update({ authorPrompt: e.target.value })} />
      </label>
      <div className="field">
        <span className="field-label judge-row">
          Writing system prompt
          {folders.some((f) => f.systemPrompt.trim()) && (
            <select value="" onChange={(e) => {
              const ws = folders.find((f) => f.id === e.target.value)
              if (ws) update({ systemPrompt: ws.systemPrompt })
            }}>
              <option value="">Use a workspace's prompt…</option>
              {folders.filter((f) => f.systemPrompt.trim()).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
        </span>
        <textarea rows={4} value={draft.systemPrompt} placeholder="The system prompt both models had (the judge scores against it)" onChange={(e) => update({ systemPrompt: e.target.value })} />
      </div>
      <div className="field">
        <span className="field-label">Reference files for the judge (character profiles, series notes…)</span>
        <div className="tw-attach">
          {draft.contextDocs.map((d, i) => (
            <span key={`${d.name}-${i}`} className="tw-badge attach-chip">
              <PaperclipIcon size={13} />
              {d.name}
              <span className="attach-size">~{formatTokens(Math.round(d.text.length / 4))}</span>
              <button className="attach-remove" aria-label={`Remove ${d.name}`} onClick={() => update({ contextDocs: draft.contextDocs.filter((_, j) => j !== i) })}>
                <CloseIcon size={11} />
              </button>
            </span>
          ))}
          <button className="tw-btn tw-btn-sm" onClick={async () => update({ contextDocs: [...draft.contextDocs, ...(await pickText())] })}>
            <PaperclipIcon size={14} />
            Attach files
          </button>
        </div>
        <span className="field-note">Shared context, ~{formatTokens(Math.round(contextChars / 4))} tokens: sent once, cached, and reused by the second run.</span>
      </div>
      <label className="field">
        <span className="field-label">Anything else to ask the judge (optional)</span>
        <textarea
          rows={3}
          value={draft.extraInstructions}
          placeholder="e.g. Pay special attention to how each handles Wren's register under pressure."
          onChange={(e) => update({ extraInstructions: e.target.value })}
        />
      </label>

      <h3 className="settings-section">Judge</h3>
      <div className="judge-settings">
        <label className="field">
          <span className="field-label">Judge model</span>
          <select
            value={`${draft.judgeProviderId}::${draft.judgeModelId}`}
            onChange={(e) => {
              const [judgeProviderId, judgeModelId] = e.target.value.split('::')
              update({ judgeProviderId, judgeModelId, effort: null })
            }}
          >
            {!models.some((m) => m.providerId === draft.judgeProviderId && m.id === draft.judgeModelId) && (
              <option value={`${draft.judgeProviderId}::${draft.judgeModelId}`}>{modelName(models, draft.judgeModelId)}</option>
            )}
            {providers.filter((p) => p.enabled).map((p) => (
              <optgroup key={p.id} label={p.name}>
                {models.filter((m) => m.providerId === p.id).map((m) => (
                  <option key={m.id} value={`${p.id}::${m.id}`}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {options.efforts.length > 0 && (
          <label className="field">
            <span className="field-label">Effort</span>
            <select value={draft.effort ?? ''} onChange={(e) => update({ effort: e.target.value || null })}>
              <option value="">{options.defaultEffort ? `Model default (${options.defaultEffort})` : 'Model default'}</option>
              {options.efforts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label judge-row">
            Rubric
            {rubric && (
              <button className="link-btn" onClick={() => setEditing(rubric)}>
                {rubric.builtIn ? 'View or copy' : 'Edit'}
              </button>
            )}
            {rubric && !rubric.builtIn && (
              <button className="link-btn" title="Save this rubric to a file" onClick={() => void window.twilight.exportRubric(rubric.id).catch(() => undefined)}>
                Export
              </button>
            )}
            <button
              className="link-btn"
              title="Add a rubric from a file"
              onClick={async () => {
                try {
                  const result = await window.twilight.importRubric()
                  if (!result) return
                  useJudge.getState().setRubrics(result.rubrics)
                  update({ rubricId: result.id })
                } catch (err) {
                  useStore.getState().setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
                }
              }}
            >
              Import
            </button>
          </span>
          <select value={draft.rubricId} onChange={(e) => update({ rubricId: e.target.value })}>
            {rubrics.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>
      {rubric && <p className="field-note">{rubric.description} {rubric.criteria.length} criteria: {rubric.criteria.map((c) => c.name).join(', ')}.</p>}
      <label className="check">
        <input type="checkbox" checked={draft.bothOrders} onChange={(e) => update({ bothOrders: e.target.checked })} />
        Judge twice with the order swapped (judges tend to favour whichever passage comes first)
      </label>
      <p className="field-note">The judge never sees model names: passages are labelled X and Y, and mapped back to A and B afterwards.</p>

      <div className="dialog-actions">
        <button className="tw-btn tw-btn-ghost" onClick={() => useJudge.setState({ draft: null })}>
          Cancel
        </button>
        <button
          className="tw-btn tw-btn-primary judge-run"
          disabled={!ready || (round && !!repeated)}
          title={round && repeated ? `Two passages are both labelled ${repeated}` : undefined}
          onClick={() => void useJudge.getState().run()}
        >
          {round ? `Start ${pairs} judgments (${runs} runs)` : `Judge ${draft.bothOrders ? '(2 runs)' : ''}`}
        </button>
      </div>
      {editing && <RubricEditor rubric={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ——— Rubric editor ———

function RubricEditor({ rubric, onClose }: { rubric: Rubric; onClose: () => void }) {
  const copy = rubric.builtIn
  const [draft, setDraft] = useState<Rubric>(copy ? { ...rubric, id: `custom-${Date.now()}`, name: `${rubric.name} (my copy)`, builtIn: false } : rubric)
  const setCriterion = (i: number, patch: Partial<RubricCriterion>): void =>
    setDraft((d) => ({ ...d, criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog rubric-dialog" role="dialog" aria-modal="true" aria-label="Rubric">
        <div className="panel-head">
          <h2 className="t-title">{copy ? 'Copy rubric' : 'Edit rubric'}</h2>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {copy && <p className="field-note">Built-in rubrics stay as they are; changes save as your own copy.</p>}
        <label className="field">
          <span className="field-label">Name</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        {draft.criteria.map((c, i) => (
          <div key={i} className="criterion">
            <div className="criterion-head">
              <input value={c.name} placeholder="Criterion" onChange={(e) => setCriterion(i, { name: e.target.value })} />
              <label className="criterion-weight">
                weight
                <input type="number" min={0.5} max={5} step={0.5} value={c.weight} onChange={(e) => setCriterion(i, { weight: Number(e.target.value) || 1 })} />
              </label>
              <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Remove ${c.name}`} onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}>
                <TrashIcon size={14} />
              </button>
            </div>
            <textarea rows={3} value={c.guide} placeholder="What the judge should look for" onChange={(e) => setCriterion(i, { guide: e.target.value })} />
          </div>
        ))}
        <button
          className="tw-btn tw-btn-sm"
          onClick={() => setDraft({ ...draft, criteria: [...draft.criteria, { id: `c${Date.now()}`, name: '', weight: 1, guide: '' }] })}
        >
          <PlusIcon size={14} />
          Add criterion
        </button>
        <div className="dialog-actions">
          {!copy && (
            <button
              className="tw-btn tw-btn-ghost danger-text"
              onClick={async () => {
                useJudge.getState().setRubrics(await window.twilight.deleteRubric(rubric.id))
                useJudge.getState().updateDraft({ rubricId: 'general-fiction' })
                onClose()
              }}
            >
              Delete rubric
            </button>
          )}
          <span className="tw-spacer" />
          <button className="tw-btn tw-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="tw-btn tw-btn-primary"
            disabled={!draft.name.trim() || draft.criteria.length === 0 || draft.criteria.some((c) => !c.name.trim())}
            onClick={async () => {
              const cleaned = { ...draft, criteria: draft.criteria.map((c) => ({ ...c, id: c.id || c.name.toLowerCase().replace(/\W+/g, '-') })) }
              useJudge.getState().setRubrics(await window.twilight.saveRubric(cleaned))
              useJudge.getState().updateDraft({ rubricId: cleaned.id })
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ——— Leaderboard ———

const PAIR_RESULT = { tie: 'Tie', close: 'Too close to call' } as const

function LeaderboardView() {
  const board = useJudge((s) => s.board)!
  const round = board.roundId !== null
  const leader = board.entries[0]
  const status = round
    ? `${board.counted} of ${board.judgments.length} pairs counted${board.running ? ` · ${board.running} still judging` : ''}`
    : `${board.counted} ${board.counted === 1 ? 'judgment' : 'judgments'} counted${board.running ? ` · ${board.running} still judging` : ''}`

  return (
    <div className="judge-result leaderboard" data-round={board.roundId ?? ''}>
      <section className="board-head">
        <div className="verdict-head">
          <h2 className="t-title">{leader ? `${leader.label} leads` : round && board.running ? 'Judging the pairs…' : 'Nothing ranked yet'}</h2>
          <span className="field-note board-status">{status}</span>
        </div>
        {round && (
          <button className="link-btn board-overall" onClick={() => void useJudge.getState().openBoard(null)}>
            Show the overall leaderboard
          </button>
        )}
      </section>

      {board.entries.length > 0 ? (
        <table className="criteria-table board-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Label</th>
              <th className="num">Rating</th>
              <th className="rec">W–L–T</th>
              <th className="num">Average score</th>
              <th className="num">Judgments</th>
            </tr>
          </thead>
          <tbody>
            {board.entries.map((e, i) => (
              <tr
                key={e.label}
                className={i === 0 ? 'board-leader' : ''}
                data-label={e.label}
                data-rank={i + 1}
                data-rating={Math.round(e.rating)}
                data-record={`${e.wins}-${e.losses}-${e.ties}`}
              >
                <td className="num">{i + 1}</td>
                <td className="board-label">{e.label}</td>
                <td className="num board-rating">{Math.round(e.rating)}</td>
                <td className="num rec">
                  {e.wins}–{e.losses}–{e.ties}
                </td>
                <td className="num">{fmt(e.averageScore)}</td>
                <td className="num">{e.judgments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty board-empty">
          <TrophyIcon size={28} />
          <p className="empty-sub">
            {round
              ? board.running
                ? 'Pairs join the table as they finish.'
                : "This round's passages aren't labelled, so there's nothing to rank."
              : 'Label the passages when you set up a comparison, and finished judgments are tallied here by label.'}
          </p>
        </div>
      )}

      {round && board.judgments.length > 0 && (
        <section className="board-pairs">
          <h3 className="settings-section">Pairs in this round</h3>
          {board.judgments.map((j) => (
            <button key={j.id} className="tw-conv board-pair" data-status={j.status} onClick={() => void useJudge.getState().open(j.id)}>
              <span className="tw-conv-title">{j.title}</span>
              <span className="tw-conv-meta">
                {j.status === 'running'
                  ? 'Judging…'
                  : j.status === 'error'
                    ? 'Failed'
                    : j.winner === 'A' || j.winner === 'B'
                      ? `${(j.winner === 'A' ? j.labelA : j.labelB) || j.winner} won`
                      : j.winner
                        ? PAIR_RESULT[j.winner]
                        : 'No verdict'}
              </span>
            </button>
          ))}
        </section>
      )}

      {!round && <ArenaBoard />}

      <p className="field-note">
        Counted by label, from finished judgments where both passages are labelled. Ratings are Elo-style: every label starts at {ELO_START}, and each
        judgment, oldest first, moves the two by up to {ELO_K} points, more for an upset. A tie or a too-close call counts as half a win each.
      </p>
    </div>
  )
}

// ——— Results ———

function RunReport({ judgment, index }: { judgment: Judgment; index: number }) {
  const run = judgment.runs[index]
  const nodeId = `${judgment.id}:${index}`
  const subscribe = (cb: () => void): (() => void) => subscribeStream(nodeId, cb)
  const live = useSyncExternalStore(subscribe, () => readStream(nodeId).text)
  if (run.status === 'streaming') {
    return live ? (
      <div className="md judge-report" dangerouslySetInnerHTML={{ __html: renderMarkdownLive(live) }} />
    ) : (
      <div className="msg-pending">
        <span className="tw-spin" /> {index === 1 ? 'Waiting for the first run, so this one can read its cache' : 'Judging'}
      </div>
    )
  }
  return (
    <>
      {run.error && <div className="tw-msg-error"><strong>{run.status === 'stopped' ? 'Stopped.' : 'Problem.'}</strong> {run.error}</div>}
      {run.text && <div className="md judge-report" dangerouslySetInnerHTML={{ __html: renderMarkdown(nodeId, run.text) }} />}
    </>
  )
}

function ScoreBar({ value, side }: { value: number | null; side: 'a' | 'b' }) {
  return (
    <div className="score">
      <div className="score-track">
        <div className={`score-fill score-${side}`} style={{ width: `${value === null ? 0 : value * 10}%` }} />
      </div>
      <span className="score-num">{fmt(value)}</span>
    </div>
  )
}

function JudgeResult() {
  const judgment = useJudge((s) => s.current)!
  const models = useStore((s) => s.models)
  const [revealed, setRevealed] = useState(false)
  const [tab, setTab] = useState(0)
  const v = computeVerdict(judgment.rubric, judgment.runs)
  const running = judgment.runs.some((r) => r.status === 'streaming')
  const { input } = judgment
  const name = (side: 'A' | 'B'): string => {
    const label = side === 'A' ? input.labelA : input.labelB
    return revealed && label ? `${side} · ${label}` : side
  }
  const headline = running
    ? 'Judging…'
    : v.winner === 'A' || v.winner === 'B'
      ? `${name(v.winner)} is better written`
      : v.winner === 'tie'
        ? 'A tie'
        : v.winner === 'close'
          ? 'Too close to call'
          : 'No verdict'
  const agreement =
    v.agreement === 'agree'
      ? `Both orders agree (${v.runWinners[0] === 'tie' ? 'tie' : `${v.runWinners[0]} both times`}).`
      : v.agreement === 'flipped'
        ? `The order changed the verdict: run 1 picked ${v.runWinners[0] ?? '–'}, run 2 picked ${v.runWinners[1] ?? '–'}.`
        : v.agreement === 'single'
          ? 'Judged once, in one order.'
          : ''

  return (
    <div className="judge-result">
      <section className={`verdict verdict-${(v.winner ?? 'none').toString().toLowerCase()}`}>
        <div className="verdict-head">
          <h2 className="t-title">{headline}</h2>
          <span className="field-note">
            {modelName(models, input.judgeModelId)} · {judgment.rubric.name}
          </span>
        </div>
        <div className="verdict-scores">
          <div>
            <span className="tw-pane-tag judge-tag-a">A</span> <b>{fmt(v.overallA)}</b>
          </div>
          <div>
            <span className="tw-pane-tag judge-tag-b">B</span> <b>{fmt(v.overallB)}</b>
          </div>
        </div>
        {agreement && <p className="field-note">{agreement} Overall scores are weighted by the rubric and averaged across runs.</p>}
        {(input.labelA || input.labelB) && !running && (
          <button className="tw-btn tw-btn-sm" onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide who wrote which' : 'Reveal who wrote which'}
          </button>
        )}
        {revealed && (
          <p className="reveal">
            A was {input.labelA || 'unlabelled'} · B was {input.labelB || 'unlabelled'}
          </p>
        )}
      </section>

      <table className="criteria-table">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Weight</th>
            <th>A</th>
            <th>B</th>
          </tr>
        </thead>
        <tbody>
          {v.criteria.map((c) => (
            <tr key={c.id} className={c.A === null && c.B === null ? 'criterion-na' : ''}>
              <td>{c.name}</td>
              <td className="num">{c.weight}</td>
              <td><ScoreBar value={c.A} side="a" /></td>
              <td><ScoreBar value={c.B} side="b" /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tw-seg run-tabs" role="tablist">
        {judgment.runs.map((r, i) => (
          <button key={i} role="tab" aria-pressed={tab === i} onClick={() => setTab(i)}>
            Run {i + 1} · {r.order === 'AB' ? 'X = A, Y = B' : 'X = B, Y = A'}
          </button>
        ))}
      </div>
      <RunReport key={tab} judgment={judgment} index={Math.min(tab, judgment.runs.length - 1)} />
    </div>
  )
}

export function JudgeView() {
  const current = useJudge((s) => s.current)
  const draft = useJudge((s) => s.draft)
  const board = useJudge((s) => s.board)
  const error = useJudge((s) => s.error)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const running = current?.runs.some((r) => r.status === 'streaming')
  const roundRunning = board?.judgments.filter((j) => j.status === 'running') ?? []
  const title = draft
    ? 'New comparison'
    : current
      ? current.input.title || 'Comparison'
      : board
        ? board.roundId
          ? board.roundTitle || 'Round'
          : 'Leaderboard'
        : 'Judge'

  return (
    <main className="chat judge">
      <header className="chat-head drag">
        <button className="tw-btn tw-btn-ghost tw-btn-icon no-drag" aria-label="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
        <h1 className="chat-title">{title}</h1>
        {current?.roundId && (
          <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag" onClick={() => void useJudge.getState().openBoard(current.roundId)}>
            <TrophyIcon />
            Round leaderboard
          </button>
        )}
        {!draft && !current && roundRunning.length > 0 && (
          <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag" onClick={() => roundRunning.forEach((j) => void window.twilight.stopJudge(j.id))}>
            Stop
          </button>
        )}
        {current && running && (
          <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag" onClick={() => void useJudge.getState().stop()}>
            Stop
          </button>
        )}
        {current && !running && (
          <>
            <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag" onClick={() => useJudge.getState().newDraft(current.input)}>
              Edit and re-run
            </button>
            <button className="tw-btn tw-btn-ghost tw-btn-sm no-drag" onClick={() => void useJudge.getState().remove(current.id)}>
              <TrashIcon />
              Delete
            </button>
          </>
        )}
      </header>
      {error && (
        <div className="tw-msg-error judge-error" role="alert" onClick={() => useJudge.setState({ error: null })}>
          <strong>Problem.</strong> {error}
        </div>
      )}
      <div className="judge-scroll">
        {draft ? (
          <JudgeForm />
        ) : current ? (
          <JudgeResult />
        ) : board ? (
          <LeaderboardView />
        ) : (
          <div className="empty">
            <h2 className="t-display">Judge two passages</h2>
            <p className="empty-sub">Blind, rubric-scored, judged in both orders. Or use “Judge A vs B” from a split chat.</p>
            <button className="tw-btn tw-btn-primary" onClick={() => useJudge.getState().newDraft()}>
              <PlusIcon />
              New comparison
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

export type { JudgeInput }
