import { useEffect, useState } from 'react'
import { hasInput, INPUT_PLACEHOLDER, type Persona, type SavedPrompt } from '@shared/library'
import { openMode } from '../commands'
import { useLibrary } from '../libraryStore'
import { modelName, useStore } from '../store'
import { ExportIcon, PenIcon, PlusIcon, TrashIcon } from './Icons'

// Settings → Library: your personas and prompts, made and changed here, and moved between
// installs as a library file.

const EMPTY_PERSONA: Persona = { id: '', name: '', description: '', systemPrompt: '', providerId: null, modelId: null, choiceCards: false }
const EMPTY_PROMPT: SavedPrompt = { id: '', name: '', text: '' }

const preview = (text: string, max = 140): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The model a persona starts chats with: the models in the picker, or the chat default. */
function ModelSelect({ persona, onChange }: { persona: Persona; onChange: (patch: Pick<Persona, 'providerId' | 'modelId'>) => void }) {
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers).filter((p) => p.enabled)
  const value = persona.providerId && persona.modelId ? `${persona.providerId}::${persona.modelId}` : ''
  const known = models.some((m) => m.providerId === persona.providerId && m.id === persona.modelId && !m.hidden)
  return (
    <select
      value={value}
      aria-label="Model"
      onChange={(e) => {
        const at = e.target.value.indexOf('::')
        onChange(at < 0 ? { providerId: null, modelId: null } : { providerId: e.target.value.slice(0, at), modelId: e.target.value.slice(at + 2) })
      }}
    >
      <option value="">The chat default</option>
      {value && !known && <option value={value}>{modelName(models, persona.modelId ?? '')} (not in the picker now)</option>}
      {providers.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {models
            .filter((m) => m.providerId === p.id && !m.hidden)
            .map((m) => (
              <option key={m.id} value={`${p.id}::${m.id}`}>
                {m.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

function PersonaEditor({ persona, onDone }: { persona: Persona; onDone: () => void }) {
  const [draft, setDraft] = useState(persona)
  const set = (patch: Partial<Persona>): void => setDraft((d) => ({ ...d, ...patch }))
  const ready = !!draft.name.trim() && !!draft.systemPrompt.trim()
  return (
    <div className="library-editor" data-editing="persona">
      <div className="field-row">
        <label className="field">
          <span className="field-label">Name</span>
          <input autoFocus value={draft.name} placeholder="For example: Patient editor" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <ModelSelect persona={draft} onChange={set} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Description</span>
        <input value={draft.description} placeholder="One line on what it's for" onChange={(e) => set({ description: e.target.value.replace(/\n/g, ' ') })} />
      </label>
      <label className="field">
        <span className="field-label">System prompt</span>
        <textarea rows={8} value={draft.systemPrompt} placeholder="Who the model is in these chats, and how it answers" onChange={(e) => set({ systemPrompt: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.choiceCards} onChange={(e) => set({ choiceCards: e.target.checked })} />
        Start chats with choice cards on (for text adventures)
      </label>
      <div className="dialog-actions">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button className="tw-btn tw-btn-primary tw-btn-sm" disabled={!ready} onClick={async () => (await useLibrary.getState().savePersona(draft)) && onDone()}>
          Save
        </button>
      </div>
    </div>
  )
}

function PromptEditor({ prompt, onDone }: { prompt: SavedPrompt; onDone: () => void }) {
  const [draft, setDraft] = useState(prompt)
  const ready = !!draft.name.trim() && !!draft.text.trim()
  return (
    <div className="library-editor" data-editing="prompt">
      <label className="field">
        <span className="field-label">Name</span>
        <input autoFocus value={draft.name} placeholder="For example: Summarize" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="field">
        <span className="field-label">Text</span>
        <textarea rows={6} value={draft.text} placeholder="The message it puts in the box" onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <span className="field-note">
          Write {INPUT_PLACEHOLDER} where something changes each time: Twilight asks for it when you insert the prompt.
        </span>
      </label>
      <div className="dialog-actions">
        <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button className="tw-btn tw-btn-primary tw-btn-sm" disabled={!ready} onClick={async () => (await useLibrary.getState().savePrompt(draft)) && onDone()}>
          Save
        </button>
      </div>
    </div>
  )
}

/** Edit, export and delete, the same on every row. */
function RowActions({ name, id, onEdit, onDelete }: { name: string; id: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="library-actions">
      <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Edit ${name}`} title="Edit" onClick={onEdit}>
        <PenIcon size={14} />
      </button>
      <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Export ${name}`} title="Save to a file" onClick={() => void useLibrary.getState().exportFile([id])}>
        <ExportIcon size={14} />
      </button>
      <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Delete ${name}`} title="Delete" onClick={onDelete}>
        <TrashIcon size={14} />
      </button>
    </span>
  )
}

export function LibrarySection() {
  const personas = useLibrary((s) => s.personas)
  const prompts = useLibrary((s) => s.prompts)
  const models = useStore((s) => s.models)
  // The persona or prompt being edited ('' for a new one).
  const [editing, setEditing] = useState<{ kind: 'persona' | 'prompt'; id: string } | null>(null)
  useEffect(() => void useLibrary.getState().refresh(), [])
  const done = (): void => setEditing(null)
  const is = (kind: 'persona' | 'prompt', id: string): boolean => editing?.kind === kind && editing.id === id

  return (
    <>
      <div className="library-bar">
        <button className="tw-btn tw-btn-sm" onClick={() => void useLibrary.getState().importFile()}>
          Import…
        </button>
        <button className="tw-btn tw-btn-sm" disabled={!personas.length && !prompts.length} onClick={() => void useLibrary.getState().exportFile()}>
          <ExportIcon size={14} />
          Export all
        </button>
        <span className="field-note">A library file carries personas and prompts to another install. Importing adds them to yours.</span>
      </div>

      <section className="settings-card library-card" data-kind="personas" aria-label="Personas">
        <div className="panel-head">
          <h3 className="t-heading">
            Personas <span className="rm-heading-count">{personas.length}</span>
          </h3>
          <button className="tw-btn tw-btn-sm" disabled={is('persona', '')} onClick={() => setEditing({ kind: 'persona', id: '' })}>
            <PlusIcon size={14} />
            New persona
          </button>
        </div>
        <p className="field-note">
          A system prompt with a name, and a model and choice cards to go with it if you like. Start a chat from one here or from the command menu, or
          apply one in a chat's model settings.
        </p>
        {is('persona', '') && <PersonaEditor persona={EMPTY_PERSONA} onDone={done} />}
        {personas.length === 0 && !is('persona', '') && <p className="library-empty">No personas yet.</p>}
        {personas.map((p) =>
          is('persona', p.id) ? (
            <PersonaEditor key={p.id} persona={p} onDone={done} />
          ) : (
            <div key={p.id} className="library-item" data-persona={p.id}>
              <div className="library-text">
                <span className="library-name">{p.name}</span>
                {p.description && <span className="library-desc">{p.description}</span>}
                <span className="library-meta">
                  <span className="tw-badge">{p.modelId ? modelName(models, p.modelId) : 'Chat default'}</span>
                  {p.choiceCards && <span className="tw-badge">Choices</span>}
                  <span className="library-preview">{preview(p.systemPrompt, 90)}</span>
                </span>
              </div>
              <button
                className="tw-btn tw-btn-sm"
                onClick={() => {
                  openMode('chat')
                  void useStore.getState().newChatFromPersona(p.id)
                }}
              >
                Start a chat
              </button>
              <RowActions name={p.name} id={p.id} onEdit={() => setEditing({ kind: 'persona', id: p.id })} onDelete={() => void useLibrary.getState().deletePersona(p.id)} />
            </div>
          )
        )}
      </section>

      <section className="settings-card library-card" data-kind="prompts" aria-label="Prompts">
        <div className="panel-head">
          <h3 className="t-heading">
            Prompts <span className="rm-heading-count">{prompts.length}</span>
          </h3>
          <button className="tw-btn tw-btn-sm" disabled={is('prompt', '')} onClick={() => setEditing({ kind: 'prompt', id: '' })}>
            <PlusIcon size={14} />
            New prompt
          </button>
        </div>
        <p className="field-note">Messages you send often. Prompts in the composer puts one in the message box, to send as it is or change first.</p>
        {is('prompt', '') && <PromptEditor prompt={EMPTY_PROMPT} onDone={done} />}
        {prompts.length === 0 && !is('prompt', '') && <p className="library-empty">No prompts yet.</p>}
        {prompts.map((p) =>
          is('prompt', p.id) ? (
            <PromptEditor key={p.id} prompt={p} onDone={done} />
          ) : (
            <div key={p.id} className="library-item" data-prompt={p.id}>
              <div className="library-text">
                <span className="library-name">{p.name}</span>
                <span className="library-meta">
                  {hasInput(p.text) && <span className="tw-badge">Fill in</span>}
                  <span className="library-preview">{preview(p.text)}</span>
                </span>
              </div>
              <RowActions name={p.name} id={p.id} onEdit={() => setEditing({ kind: 'prompt', id: p.id })} onDelete={() => void useLibrary.getState().deletePrompt(p.id)} />
            </div>
          )
        )}
      </section>
    </>
  )
}
