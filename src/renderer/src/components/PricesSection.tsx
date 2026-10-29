import { useState, type ReactElement } from 'react'
import { BUILT_IN_PRICES, type CustomPrice } from '@shared/pricing'
import { useStore } from '../store'
import { PlusIcon, TrashIcon } from './Icons'

const num = (v: string): number | null => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** One of your prices, edited in place; it saves when a field loses focus. */
function PriceRow({ price, index, models }: { price: CustomPrice; index: number; models: string[] }) {
  const [draft, setDraft] = useState({
    model: price.model,
    input: String(price.input),
    output: String(price.output),
    cacheRead: price.cacheRead == null ? '' : String(price.cacheRead),
    cacheWrite: price.cacheWrite == null ? '' : String(price.cacheWrite)
  })
  const save = (): void => {
    const input = num(draft.input)
    const output = num(draft.output)
    if (!draft.model.trim() || input === null || output === null) return
    const list = [...useStore.getState().prices]
    list[index] = { model: draft.model.trim(), input, output, cacheRead: num(draft.cacheRead), cacheWrite: num(draft.cacheWrite) }
    void useStore.getState().setPrices(list)
  }
  const field = (key: keyof typeof draft, label: string, placeholder = ''): ReactElement => (
    <input
      aria-label={label}
      className={key === 'model' ? 'price-model' : 'price-num'}
      list={key === 'model' ? 'price-models' : undefined}
      inputMode={key === 'model' ? undefined : 'decimal'}
      value={draft[key]}
      placeholder={placeholder}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      onBlur={save}
    />
  )
  const invalid = !draft.model.trim() || num(draft.input) === null || num(draft.output) === null
  return (
    <tr className={invalid ? 'price-invalid' : ''} data-price={price.model}>
      <td>{field('model', 'Model id or pattern', models[0] ?? 'openai/gpt-*')}</td>
      <td>{field('input', 'Input, per million tokens')}</td>
      <td>{field('output', 'Output, per million tokens')}</td>
      <td>{field('cacheRead', 'Cache read, per million tokens', 'auto')}</td>
      <td>{field('cacheWrite', 'Cache write, per million tokens', 'auto')}</td>
      <td>
        <button
          className="tw-btn tw-btn-ghost tw-btn-icon"
          aria-label={`Remove the price for ${price.model}`}
          onClick={() => void useStore.getState().setPrices(useStore.getState().prices.filter((_, j) => j !== index))}
        >
          <TrashIcon size={14} />
        </button>
      </td>
    </tr>
  )
}

/** Settings → Prices: your own per-million prices, and the built-in ones they override. */
export function PricesSection() {
  const prices = useStore((s) => s.prices)
  const models = useStore((s) => s.models)
  const ids = [...new Set(models.filter((m) => !m.hidden).map((m) => m.id))]
  const add = (model = ''): void => void useStore.getState().setPrices([...prices, { model, input: 0, output: 0 }])
  return (
    <>
      <div className="settings-card">
        <div className="panel-head">
          <h3 className="t-heading">Your prices</h3>
          <button className="tw-btn tw-btn-sm" onClick={() => add()}>
            <PlusIcon size={14} />
            Add a price
          </button>
        </div>
        <p className="field-note">
          US dollars per million tokens. Match a model by its id, or use * for a whole family (openai/gpt-*). Yours come before the built-in prices, and a
          provider that reports its own cost (OpenRouter does) comes before both. Leave the cache prices empty for the usual tenth of input to read and
          1.25× (or 2× for the hour-long cache) to write.
        </p>
        {prices.length > 0 ? (
          <table className="price-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cache read</th>
                <th>Cache write</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <PriceRow key={`${i}:${prices.length}`} price={p} index={i} models={ids} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="field-note">None yet. Local models are free unless you price them here.</p>
        )}
        <datalist id="price-models">
          {ids.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </div>
      <div className="settings-card">
        <h3 className="t-heading">Built in</h3>
        <p className="field-note">Anthropic's list prices. Add a price above with the same model to use your own instead.</p>
        <table className="price-table price-builtin">
          <thead>
            <tr>
              <th>Models</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cache read</th>
            </tr>
          </thead>
          <tbody>
            {BUILT_IN_PRICES.map((b) => (
              <tr key={b.pattern}>
                <td>{b.pattern}</td>
                <td>${b.price.input}</td>
                <td>${b.price.output}</td>
                <td>${+(b.price.input * b.price.readMultiplier).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
