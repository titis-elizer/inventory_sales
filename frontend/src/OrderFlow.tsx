import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { Order, ProductList } from './types'
import { formatIDR, pageCount } from './productLogic'
import { SubmissionGate } from './stockLogic'
import { hasOrderErrors, orderError, orderInput, validateOrder } from './orderLogic'
import type { OrderErrors, OrderRow } from './orderLogic'

export default function OrderFlow({ onBack, onMutation }: { onBack: () => void; onMutation: () => void }) {
  const [customer, setCustomer] = useState('')
  const [items, setItems] = useState<OrderRow[]>([{ key: 1, sku: '', qty: '1' }])
  const nextKey = useRef(2)
  const [errors, setErrors] = useState<OrderErrors>({ rows: {} })
  const [failure, setFailure] = useState<{ message: string; sku?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const gate = useRef(new SubmissionGate())
  const [order, setOrder] = useState<Order | null>(null)
  const [search, setSearch] = useState('')
  const [catalogQuery, setCatalogQuery] = useState({ search: '', page: 1 })
  const [catalog, setCatalog] = useState<ProductList | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [catalogRevision, setCatalogRevision] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => setCatalogQuery({ search: search.trim(), page: 1 }), 350)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (order) return
    const controller = new AbortController()
    setCatalogLoading(true)
    setCatalogError('')
    api.products({ ...catalogQuery, filter: 'all', limit: 20 }, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        const lastPage = pageCount(result.total, 20)
        if (catalogQuery.page > lastPage) setCatalogQuery(previous => ({ ...previous, page: lastPage }))
        else setCatalog(result)
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCatalogError(orderError(error).message)
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading(false)
    })
    return () => controller.abort()
  }, [catalogQuery, catalogRevision, order])

  function changeItem(key: number, update: Partial<Pick<OrderRow, 'sku' | 'qty'>>) {
    setItems(previous => previous.map(row => row.key === key ? { ...row, ...update } : row))
    setErrors({ rows: {} })
    setFailure(null)
  }
  function create(event: FormEvent) {
    event.preventDefault()
    void gate.current.run(async () => {
      const values = { customer, items }
      const invalid = validateOrder(values)
      setErrors(invalid)
      setFailure(null)
      if (hasOrderErrors(invalid)) return
      setSaving(true)
      try {
        const result = await api.createOrder(orderInput(values))
        setOrder(result)
        onMutation()
      } catch (error) { setFailure(orderError(error)) }
      finally { setSaving(false) }
    })
  }
  function reloadDetail() {
    if (!order) return
    void gate.current.run(async () => {
      setSaving(true)
      setFailure(null)
      try {
        setOrder(await api.order(order.id))
        onMutation()
      } catch (error) { setFailure(orderError(error)) }
      finally { setSaving(false) }
    })
  }
  function cancel() {
    if (!order || saving || order.status === 'CANCELLED') return
    if (!window.confirm(`Cancel order #${order.id}? Stock will be restored for all items.`)) return
    void gate.current.run(async () => {
      setSaving(true)
      setFailure(null)
      try {
        setOrder(await api.cancelOrder(order.id))
        onMutation()
      } catch (error) { setFailure(orderError(error)) }
      finally { setSaving(false) }
    })
  }

  const pickerLoading = catalogLoading || search.trim() !== catalogQuery.search
  return <section className="panel" aria-labelledby="order-title" aria-busy={saving}>
    <div className="toolbar"><h2 id="order-title">{order ? `Order #${order.id}` : 'Create sales order'}</h2>
      <button className="secondary" disabled={saving} onClick={onBack}>Back to products</button></div>
    {failure && <div className="alert" role="alert">{failure.sku && <strong>SKU {failure.sku}: </strong>}{failure.message}</div>}
    {order ? <>
      <dl className="order-metadata">
        <div><dt>Customer</dt><dd>{order.customer}</dd></div>
        <div><dt>Status</dt><dd><span className={order.status === 'CANCELLED' ? 'badge inactive' : 'badge'}>{order.status}</span></dd></div>
        <div><dt>Created</dt><dd><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString('en-US')}</time></dd></div>
        <div><dt>Cancelled</dt><dd>{order.cancelled_at ? <time dateTime={order.cancelled_at}>{new Date(order.cancelled_at).toLocaleString('en-US')}</time> : '—'}</dd></div>
      </dl>
      <div className="table-wrap"><table><caption className="sr-only">Order items and server unit prices</caption>
        <thead><tr><th>SKU</th><th>Quantity</th><th>Unit price (IDR)</th></tr></thead>
        <tbody>{order.items.map(item => <tr key={item.id} className={failure?.sku === item.sku ? 'conflict-row' : undefined}>
          <td>{item.sku}</td><td>{item.qty}</td><td>{formatIDR(item.unit_price)}</td>
        </tr>)}</tbody></table></div>
      <p className="order-total">Server total: <strong>{formatIDR(order.total)}</strong></p>
      <div className="actions"><button className="secondary" disabled={saving} onClick={reloadDetail}>Refresh detail</button>
        <button className="danger" disabled={saving || order.status === 'CANCELLED'} onClick={cancel}>{saving ? 'Processing…' : 'Cancel order'}</button></div>
    </> : <form onSubmit={create} noValidate>
      <fieldset className="order-fields" disabled={saving}>
        <label htmlFor="order-customer">Customer name</label>
        <input id="order-customer" value={customer} onChange={event => setCustomer(event.target.value)} aria-invalid={!!errors.customer} aria-describedby={errors.customer ? 'customer-error' : undefined} />
        {errors.customer && <small id="customer-error" className="field-error">{errors.customer}</small>}
        <label htmlFor="sku-search">Search product options by SKU or name</label>
        <input id="sku-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search all products" />
        <div aria-live="polite">{pickerLoading ? <p role="status">Loading product options…</p> : catalogError ?
          <div className="alert" role="alert">{catalogError}<button type="button" onClick={() => setCatalogRevision(value => value + 1)}>Try again</button></div> :
          <p>{catalog?.total ?? 0} products found. Select a SKU below. Prices and stock are verified by the server.</p>}</div>
        <div className="actions">
          <button type="button" className="secondary" disabled={pickerLoading || !!catalogError || catalogQuery.page === 1} onClick={() => setCatalogQuery(value => ({ ...value, page: value.page - 1 }))}>Previous options</button>
          <span>Page {catalogQuery.page} of {pageCount(catalog?.total ?? 0, 20)}</span>
          <button type="button" className="secondary" disabled={pickerLoading || !!catalogError || catalogQuery.page >= pageCount(catalog?.total ?? 0, 20)} onClick={() => setCatalogQuery(value => ({ ...value, page: value.page + 1 }))}>Next options</button>
        </div>
        <h3>Items</h3>
        {errors.items && <p className="field-error" role="alert">{errors.items}</p>}
        {items.map((row, index) => {
          const rowError = errors.rows[row.key]
          const conflict = failure?.sku === row.sku.trim()
          return <div className={`order-item${conflict ? ' conflict-row' : ''}`} key={row.key}>
            <label htmlFor={`order-sku-${row.key}`}>SKU — item {index + 1}</label>
            <select id={`order-sku-${row.key}`} value={row.sku} disabled={pickerLoading || !!catalogError} onChange={event => changeItem(row.key, { sku: event.target.value })}
              aria-invalid={!!rowError?.sku || conflict} aria-describedby={rowError?.sku || conflict ? `order-sku-error-${row.key}` : undefined}>
              <option value="">Select SKU</option>
              {row.sku && (pickerLoading || !!catalogError || !catalog?.data.some(product => product.sku === row.sku)) && <option value={row.sku}>{row.sku} (selected)</option>}
              {!pickerLoading && !catalogError && catalog?.data.map(product => <option key={product.id} value={product.sku}>{product.sku} — {product.name} · Stock: {product.stock}</option>)}
            </select>
            {(rowError?.sku || conflict) && <small className="field-error" id={`order-sku-error-${row.key}`}>{rowError?.sku || failure?.message}</small>}
            <label htmlFor={`order-qty-${row.key}`}>Quantity</label>
            <input id={`order-qty-${row.key}`} inputMode="numeric" value={row.qty} onChange={event => changeItem(row.key, { qty: event.target.value })}
              aria-invalid={!!rowError?.qty} aria-describedby={rowError?.qty ? `order-qty-error-${row.key}` : undefined} />
            {rowError?.qty && <small className="field-error" id={`order-qty-error-${row.key}`}>{rowError.qty}</small>}
            <button type="button" className="danger" onClick={() => { setItems(previous => previous.filter(item => item.key !== row.key)); setErrors({ rows: {} }); setFailure(null) }} aria-label={`Remove item ${index + 1}`}>Remove item</button>
          </div>
        })}
        <button type="button" className="secondary" onClick={() => { const key = nextKey.current++; setItems(previous => [...previous, { key, sku: '', qty: '1' }]) }}>+ Add item</button>
      </fieldset>
      <p>The final total and unit prices will be returned by the server after creation.</p>
      <button disabled={saving}>{saving ? 'Creating order…' : 'Create order'}</button>
    </form>}
  </section>
}