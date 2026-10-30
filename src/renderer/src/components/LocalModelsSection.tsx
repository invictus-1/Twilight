import { useEffect, useState } from 'react'
import { FIT_LABEL, paramsLabel, sizeLabel, type HubModel, type HubVariant, type LocalState, type ModelFit } from '@shared/localModels'
import { useStore } from '../store'
import { ChevronDown, ChevronRight, ChipIcon, FolderIcon, SearchIcon, TrashIcon } from './Icons'

// Settings → Models on this PC: what this computer can run, llama.cpp fetched and started for
// you, the models you've downloaded, and a search of Hugging Face where every size says whether
// it fits before you download it.

const api = window.twilight
const count = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

function Fit({ fit }: { fit: ModelFit }) {
  return <span className={`fit-badge fit-${fit}`}>{FIT_LABEL[fit]}</span>
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, (done / Math.max(1, total)) * 100)
  return (
    <div className="library-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function LocalModelsSection() {
  const [state, setState] = useState<LocalState | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HubModel[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [variants, setVariants] = useState<Record<string, HubVariant[] | 'loading' | { error: string }>>({})
  useEffect(() => {
    void api.getLocalModels().then(setState)
    return api.onLocalModels((s) => {
      setState(s)
      // A started server or a new model changes what the model picker offers.
      void useStore.getState().refreshModels()
      void api.listProviders().then((p) => useStore.getState().setProviders(p))
    })
  }, [])
  if (!state) return null
  const { hardware: hw, engine } = state
  const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  const search = async (): Promise<void> => {
    setSearching(true)
    setError(null)
    try {
      setResults(await api.searchHubModels(query))
    } catch (err) {
      setError(clean(err))
    } finally {
      setSearching(false)
    }
  }
  const toggle = async (repo: string): Promise<void> => {
    if (open === repo) return setOpen(null)
    setOpen(repo)
    if (variants[repo] && variants[repo] !== 'loading' && !('error' in (variants[repo] as object))) return
    setVariants((v) => ({ ...v, [repo]: 'loading' }))
    try {
      const list = await api.hubModelVariants(repo)
      setVariants((v) => ({ ...v, [repo]: list }))
    } catch (err) {
      setVariants((v) => ({ ...v, [repo]: { error: clean(err) } }))
    }
  }

  return (
    <>
      <div className="settings-card local-pc">
        <h3 className="t-heading">This PC</h3>
        <p className="local-hardware">
          <ChipIcon size={14} />
          {sizeLabel(hw.memory)} memory · {hw.gpu ? `${hw.gpu.name}, ${sizeLabel(hw.gpu.memory)}` : 'no graphics card with memory of its own'} · {hw.cpus} processor threads
        </p>
        <p className="field-note">Every model size below is checked against this: whether it fits on the graphics card (fast), needs some of the system memory too (slower), or is too large.</p>
      </div>

      <div className="settings-card local-engine">
        <h3 className="t-heading">llama.cpp</h3>
        <p className="field-note">
          Twilight runs your downloaded models with llama.cpp, fetched from its official releases on GitHub. One server serves every model in the folder and loads the one a chat asks for. It shows in the model picker as This PC. LM Studio and Ollama work too, as providers in Model providers.
        </p>
        {engine.installing ? (
          <>
            <p className="field-note" aria-live="polite">
              Getting llama.cpp: {sizeLabel(engine.installing.done)} of {sizeLabel(engine.installing.total)}…
            </p>
            <Progress done={engine.installing.done} total={engine.installing.total} />
          </>
        ) : !engine.version && !engine.running && !engine.starting ? (
          <div className="data-actions">
            <button className="tw-btn tw-btn-sm local-install" onClick={() => void api.installLlama()}>
              Get llama.cpp
            </button>
            <span className="field-note">{hw.gpu ? 'The Vulkan build, which runs on any recent graphics card.' : 'The build for the processor.'} About 40 MB.</span>
          </div>
        ) : (
          <>
            <p className="local-engine-status" aria-live="polite">
              <span className={`local-dot ${engine.running ? 'is-on' : ''}`} />
              {engine.starting ? 'Starting…' : `${engine.running ? 'Running' : 'Stopped'} · llama.cpp${engine.version ? ` ${engine.version} (${engine.kind})` : ''}`}
            </p>
            <div className="data-actions">
              {engine.running ? (
                <button className="tw-btn tw-btn-sm local-stop" onClick={() => void api.stopLlama()}>
                  Stop
                </button>
              ) : (
                <button className="tw-btn tw-btn-sm local-start" disabled={engine.starting} onClick={() => void api.startLlama()}>
                  Start
                </button>
              )}
              <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void api.installLlama()}>
                Update llama.cpp
              </button>
              <label className="check">
                <input type="checkbox" checked={state.autoStart} onChange={(e) => void api.setLlamaAutoStart(e.target.checked)} />
                Start with Twilight
              </label>
            </div>
          </>
        )}
        {engine.error && <p className="form-error">{engine.error}</p>}
      </div>

      <div className="settings-card local-models">
        <h3 className="t-heading">Downloaded models</h3>
        <div className="field-inline">
          <span className="folder-path log-path">{state.folder}</span>
          <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label="Open the models folder" title="Open the models folder" onClick={() => void api.openModelsFolder()}>
            <FolderIcon size={14} />
          </button>
          <button className="tw-btn tw-btn-sm" onClick={() => void api.chooseModelsFolder().then(setState)}>
            Choose…
          </button>
        </div>
        {state.downloads.map((d) => (
          <div key={d.key} className="local-download">
            <div className="field-inline">
              <span className="local-name">
                {d.repo} · {d.variant}
              </span>
              <span className="field-note">{d.error ? '' : `${sizeLabel(d.done)} of ${sizeLabel(d.total)}`}</span>
              <button className="tw-btn tw-btn-ghost tw-btn-sm" onClick={() => void api.cancelLocalDownload(d.key)}>
                {d.error ? 'Dismiss' : 'Cancel'}
              </button>
            </div>
            {d.error ? <p className="form-error">{d.error}</p> : <Progress done={d.done} total={d.total} />}
          </div>
        ))}
        {state.models.map((m) => (
          <div key={m.name} className="field-inline local-model">
            <span className="local-name" title={m.repo ?? undefined}>
              {m.name}
            </span>
            <span className="field-note">{sizeLabel(m.size)}</span>
            <Fit fit={m.fit} />
            <button className="tw-btn tw-btn-ghost tw-btn-icon" aria-label={`Move ${m.name} to the Recycle Bin`} title="Move to the Recycle Bin" onClick={() => void api.removeLocalModel(m.name)}>
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
        {!state.models.length && !state.downloads.length && <p className="sidebar-empty">No models yet. Find one below.</p>}
      </div>

      <div className="settings-card local-search">
        <h3 className="t-heading">Find a model</h3>
        <form
          className="library-try"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <input value={query} placeholder="Search Hugging Face, like qwen, gemma or mistral" onChange={(e) => setQuery(e.target.value)} />
          <button className="tw-btn tw-btn-sm" type="submit" disabled={searching}>
            <SearchIcon size={14} />
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        <p className="field-note">GGUF models, most downloaded first. Open one to see its sizes; smaller sizes lose a little quality and need far less memory. Q4_K_M is the usual choice.</p>
        {error && <p className="form-error">{error}</p>}
        {results && (
          <ul className="hub-results">
            {results.map((r) => {
              const v = variants[r.id]
              return (
                <li key={r.id} className="hub-model">
                  <button className="hub-model-head" aria-expanded={open === r.id} onClick={() => void toggle(r.id)}>
                    {open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="local-name">{r.id}</span>
                    <span className="field-note">
                      {[paramsLabel(r.params), r.vision ? 'sees pictures' : '', `${count(r.downloads)} downloads`, r.gated ? 'needs an account' : ''].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  {open === r.id && (
                    <div className="hub-variants">
                      {v === 'loading' && <p className="field-note">Reading its files…</p>}
                      {v && typeof v === 'object' && 'error' in v && <p className="form-error">{v.error}</p>}
                      {Array.isArray(v) && !v.length && <p className="field-note">No GGUF files in this repository.</p>}
                      {Array.isArray(v) &&
                        v.map((x) => {
                          const busy = state.downloads.some((d) => d.repo === r.id && d.variant === x.name)
                          return (
                            <div key={x.name} className="field-inline hub-variant">
                              <span className="local-name">{x.name}</span>
                              <span className="field-note">
                                {sizeLabel(x.size)}
                                {x.files.length > 1 ? ` in ${x.files.length} parts` : ''}
                              </span>
                              <Fit fit={x.fit} />
                              <button className="tw-btn tw-btn-sm hub-download" disabled={busy || r.gated || x.fit === 'no'} title={r.gated ? 'This model needs a Hugging Face account and accepted terms.' : undefined} onClick={() => void api.downloadLocalModel(r.id, x)}>
                                {busy ? 'Downloading…' : 'Download'}
                              </button>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </li>
              )
            })}
            {!results.length && <li className="field-note">Nothing matched.</li>}
          </ul>
        )}
      </div>
    </>
  )
}
