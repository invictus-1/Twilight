import { useEffect, useState } from 'react'
import type { ArenaVote, ArenaWinner, NodeView } from '@shared/types'
import { ELO_K, ELO_START, tallyLeaderboard, type LeaderboardEntry } from '@shared/judge'
import { modelName, useStore } from '../store'
import { CloseIcon, LockIcon, TrophyIcon } from './Icons'

// The blind arena: in a split chat, Blind shuffles the two models and hides which pane has which.
// After a pair of replies you vote, the names show, and the vote joins your own leaderboard
// (Judge → Leaderboard). Another round shuffles again.

/** True while the open chat is in a blind round: model names, prices and the picker stay hidden. */
export const useBlind = (): boolean => useStore((s) => !!s.current?.split && !!s.current?.blind)

export function BlindToggle() {
  const blind = useBlind()
  return (
    <button
      className="tw-btn tw-btn-ghost tw-btn-sm no-drag arena-toggle"
      aria-pressed={blind}
      title={blind ? 'End the blind round and show the models' : 'Blind arena: shuffle the two models and hide which is which until you vote'}
      onClick={() => void useStore.getState().setBlind(!blind)}
    >
      <LockIcon />
      Blind
    </button>
  )
}

/** A finished reply written since the blind round began. */
const done = (path: NodeView[] | undefined, since: number): boolean => {
  const last = path?.at(-1)
  return last?.role === 'assistant' && last.status === 'done' && last.createdAt >= since
}

const VOTES: { winner: ArenaWinner; label: string }[] = [
  { winner: 'a', label: 'A is better' },
  { winner: 'tie', label: 'Tie' },
  { winner: 'b', label: 'B is better' },
  { winner: 'bad', label: 'Both bad' }
]

const VERDICT: Record<ArenaWinner, string> = { a: 'You picked A', b: 'You picked B', tie: 'You called it a tie', bad: 'You found both bad' }

/** Under a blind split: the vote once both replies are in, then who was who. */
export function ArenaBar() {
  const blind = useBlind()
  const current = useStore((s) => s.current)
  const reveal = useStore((s) => s.arenaReveal)
  const models = useStore((s) => s.models)
  if (reveal && reveal.conversationId === current?.id) {
    return (
      <div className="arena-bar arena-reveal" role="status">
        <TrophyIcon size={14} />
        <span>
          {VERDICT[reveal.winner]}. A was <strong data-pane="a">{modelName(models, reveal.a.modelId)}</strong>, B was{' '}
          <strong data-pane="b">{modelName(models, reveal.b.modelId)}</strong>.
        </span>
        <span className="tw-spacer" />
        <button className="tw-btn tw-btn-sm arena-again" onClick={() => void useStore.getState().setBlind(true)}>
          Another blind round
        </button>
        <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={() => useStore.setState({ arenaReveal: null })}>
          <CloseIcon size={12} />
        </button>
      </div>
    )
  }
  if (!blind || !current) return null
  const since = current.blindSince ?? 0
  const ready = done(current.path, since) && done(current.split?.path, since)
  return (
    <div className="arena-bar" role="group" aria-label="Vote">
      <LockIcon size={14} />
      <span>{ready ? 'Which reply is better?' : 'Blind round: send a message to both panes, then vote. The models show after.'}</span>
      <span className="tw-spacer" />
      {ready &&
        VOTES.map((v) => (
          <button key={v.winner} className="tw-btn tw-btn-sm arena-vote" data-winner={v.winner} onClick={() => void useStore.getState().voteArena(v.winner)}>
            {v.label}
          </button>
        ))}
    </div>
  )
}

/** The arena's own table: Elo from your blind votes, by model. */
export function ArenaBoard() {
  const models = useStore((s) => s.models)
  const [votes, setVotes] = useState<ArenaVote[] | null>(null)
  useEffect(() => {
    void window.twilight.arenaVotes().then(setVotes)
  }, [])
  if (!votes) return null
  const name = (id: string): string => modelName(models, id)
  const entries: LeaderboardEntry[] = tallyLeaderboard(
    votes.map((v) => ({
      labelA: name(v.a.modelId),
      labelB: name(v.b.modelId),
      winner: v.winner === 'a' ? 'A' : v.winner === 'b' ? 'B' : 'tie',
      overallA: null,
      overallB: null,
      createdAt: v.at
    }))
  )
  return (
    <section className="arena-board">
      <h3 className="settings-section">Blind arena</h3>
      {entries.length ? (
        <table className="criteria-table board-table arena-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Model</th>
              <th className="num">Rating</th>
              <th className="rec">W–L–T</th>
              <th className="num">Votes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.label} className={i === 0 ? 'board-leader' : ''} data-label={e.label} data-rating={Math.round(e.rating)} data-record={`${e.wins}-${e.losses}-${e.ties}`}>
                <td className="num">{i + 1}</td>
                <td className="board-label">{e.label}</td>
                <td className="num board-rating">{Math.round(e.rating)}</td>
                <td className="num rec">
                  {e.wins}–{e.losses}–{e.ties}
                </td>
                <td className="num">{e.judgments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="field-note">No votes yet. Split a chat, press Blind, and vote on the two replies.</p>
      )}
      <p className="field-note">
        From your own votes in blind split chats: every model starts at {ELO_START} and each vote moves the two by up to {ELO_K} points. A tie or both bad counts as half a
        win each.
      </p>
    </section>
  )
}
