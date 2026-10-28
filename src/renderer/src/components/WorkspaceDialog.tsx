import { useState } from 'react'
import type { ChatFolder } from '@shared/types'
import { modelName, useStore } from '../store'
import { CloseIcon } from './Icons'

/** Accent tokens a workspace can be tagged with (the design system's own hues). */
export const WORKSPACE_COLORS = ['', 'iris', 'dusk', 'horizon', 'success', 'warning', 'danger', 'ink-muted']

/** Edit a workspace: its name and look, and the defaults new chats in it start with. */
export function WorkspaceDialog({ workspace, onClose }: { workspace: ChatFolder; onClose: () => void }) {
  const models = useStore((s) => s.models)
  const providers = useStore((s) => s.providers)
  const [draft, setDraft] = useState(workspace)
  const set = (patch: Partial<ChatFolder>): void => setDraft((d) => ({ ...d, ...patch }))
  const save = async (): Promise<void> => {
    const { id: _id, collapsed: _c, ...patch } = draft
    await useStore.getState().updateWorkspace(workspace.id, patch)
    onClose()
  }
  const enabled = providers.filter((p) => p.enabled)

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog workspace-dialog" role="dialog" aria-modal="true" aria-label="Edit workspace">
        <div className="panel-head">
          <h2 className="t-title">Edit workspace</h2>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <label className="field">
          <span className="field-label">Name</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </label>

        <div className="field">
          <span className="field-label">Color</span>
          <div className="swatches" role="radiogroup" aria-label="Color">
            {WORKSPACE_COLORS.map((c) => (
              <button
                key={c || 'none'}
                role="radio"
                aria-checked={draft.color === c}
                aria-label={c || 'No color'}
                className={`swatch ${c ? '' : 'swatch-none'}`}
                style={c ? { background: `var(--${c})` } : undefined}
                onClick={() => set({ color: c })}
              />
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Default model for new chats</span>
          <select
            value={draft.providerId && draft.modelId ? `${draft.providerId}::${draft.modelId}` : ''}
            onChange={(e) => {
              const [providerId, modelId] = e.target.value ? e.target.value.split('::') : [null, null]
              set({ providerId, modelId })
            }}
          >
            <option value="">Twilight's default</option>
            {draft.providerId && draft.modelId && !models.some((m) => m.providerId === draft.providerId && m.id === draft.modelId) && (
              <option value={`${draft.providerId}::${draft.modelId}`}>{modelName(models, draft.modelId)} (not available now)</option>
            )}
            {enabled.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {models
                  .filter((m) => m.providerId === p.id)
                  .map((m) => (
                    <option key={m.id} value={`${p.id}::${m.id}`}>
                      {m.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea rows={2} value={draft.description} placeholder="What this workspace is for" onChange={(e) => set({ description: e.target.value })} />
        </label>

        <label className="field">
          <span className="field-label">Default system prompt</span>
          <textarea
            rows={6}
            value={draft.systemPrompt}
            placeholder="New chats in this workspace start with this. Each chat can still change its own."
            onChange={(e) => set({ systemPrompt: e.target.value })}
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={draft.includeContext} onChange={(e) => set({ includeContext: e.target.checked })} />
          Put the workspace name and description at the top of new chats' system prompt
        </label>
        <p className="field-note">These defaults apply to chats started in this workspace from now on; existing chats keep their own settings.</p>

        <div className="dialog-actions">
          <button className="tw-btn tw-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="tw-btn tw-btn-primary" disabled={!draft.name.trim()} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
