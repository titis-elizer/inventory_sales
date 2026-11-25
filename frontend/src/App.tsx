import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { Product, ProductInput, ProductList, ProductQuery, ProductSummary } from './types'
import { changeCriteria, formatIDR, LatestRequest, pageCount, relativeMovement } from './productLogic'
import ProductForm from './ProductForm'
import StockAdjustmentModal from './StockAdjustmentModal'
import MovementHistory from './MovementHistory'
import OrderFlow from './OrderFlow'
import './style.css'

const errorMessage = (error: unknown) => error instanceof ApiError
  ? `${error.message} (${error.code})` : 'Something went wrong. Please try again.'

export default function App() {
  const [view, setView] = useState<'products' | 'order'>('products')
  const [query, setQuery] = useState<ProductQuery>({ search: '', filter: 'all', page: 1, limit: 10 })
  const [search, setSearch] = useState('')
  const [list, setList] = useState<ProductList | null>(null)
  const [summary, setSummary] = useState<ProductSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<{ product: Product | null } | null>(null)
  const [adjustment, setAdjustment] = useState<Product | null>(null)
  const [history, setHistory] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const requests = useRef(new LatestRequest())
  const summaryRequests = useRef(new LatestRequest())
  const busy = saving || deleting !== null

  function criteria(next: Partial<Pick<ProductQuery, 'search' | 'filter' | 'limit'>>) {
    requests.current.next()
    setLoading(true)
    setQuery(previous => changeCriteria(previous, next))
  }
  function refresh() {
    requests.current.next()
    summaryRequests.current.next()
    setLoading(true)
    setSummaryLoading(true)
    setRevision(previous => previous + 1)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      requests.current.next()
      setLoading(true)
      setQuery(previous => changeCriteria(previous, { search: search.trim() }))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    const version = requests.current.next()
    setLoading(true)
    setListError('')
    api.products(query, controller.signal).then(result => {
      if (!requests.current.isCurrent(version)) return
      const lastPage = pageCount(result.total, query.limit)
      if (query.page > lastPage) {
        setQuery(previous => ({ ...previous, page: lastPage }))
      } else setList(result)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && requests.current.isCurrent(version)) setListError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted && requests.current.isCurrent(version)) setLoading(false)
    })
    return () => { controller.abort(); requests.current.next() }
  }, [query, revision])

  useEffect(() => {
    const controller = new AbortController()
    const version = summaryRequests.current.next()
    setSummaryLoading(true)
    setSummaryError('')
    api.summary(controller.signal).then(result => {
      if (summaryRequests.current.isCurrent(version)) setSummary(result)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && summaryRequests.current.isCurrent(version)) setSummaryError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted && summaryRequests.current.isCurrent(version)) setSummaryLoading(false)
    })
    return () => { controller.abort(); summaryRequests.current.next() }
  }, [revision])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  async function save(input: ProductInput) {
    if (busy) return
    setSaving(true)
    setFormError('')
    try {
      if (editor?.product) await api.updateProduct(editor.product.id, input)
      else await api.createProduct(input)
      setEditor(null)
      setNotice('Product saved successfully.')
      refresh()
    } catch (error) { setFormError(errorMessage(error)) } finally { setSaving(false) }
  }

  async function remove(product: Product) {
    if (busy || !window.confirm(`Delete ${product.sku} — ${product.name}? This action cannot be undone.`)) return
    setDeleting(product.id)
    setMutationError('')
    setNotice('')
    try {
      await api.deleteProduct(product.id)
      setNotice('Product deleted successfully.')
      refresh()
    } catch (error) { setMutationError(errorMessage(error)) } finally { setDeleting(null) }
  }

  const pages = list ? pageCount(list.total, query.limit) : 1
  const pendingSearch = search.trim() !== query.search
  const tableLoading = loading || pendingSearch
  return <main className="container">
    {view === 'order' && <OrderFlow onBack={() => { refresh(); setView('products') }} onMutation={refresh} />}
    <div hidden={view !== 'products'}>
    <header><div><p className="eyebrow">STOCKFLOW</p><h1>Products & inventory</h1><p>Manage your product catalog and monitor warehouse stock.</p></div>
      <div className="actions"><button className="secondary" disabled={busy} onClick={() => setView('order')}>+ Create order</button>
        <button disabled={busy} onClick={() => { setFormError(''); setEditor({ product: null }) }}>+ Add product</button></div></header>
    {notice && <div className="notice" role="status">{notice}</div>}
    {mutationError && <div className="alert" role="alert">{mutationError} <button className="secondary" onClick={() => setMutationError('')}>Dismiss</button></div>}
    <section aria-label="Global summary" aria-busy={summaryLoading}>
      {summaryError ? <div className="alert" role="alert">Unable to load summary: {summaryError} <button onClick={refresh}>Try again</button></div> :
        <div className="stats">{[
          ['Total products', summary?.total_products], ['Active products', summary?.active_products],
          ['Total stock value', summary ? formatIDR(summary.total_stock_value) : undefined], ['Low stock (≤ 10)', summary?.low_stock_count],
        ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{summaryLoading ? '…' : value ?? '—'}</strong></article>)}</div>}
    </section>
    <section className="panel" aria-label="Product list">
      <div className="toolbar">
        <label>Search by SKU or name<input type="search" value={search} onChange={event => {
          requests.current.next()
          setLoading(true)
          setSearch(event.target.value)
          if (query.page !== 1) setQuery(previous => ({ ...previous, page: 1 }))
        }} placeholder="Example: coffee" /></label>
        <label>Filter<select value={query.filter} onChange={e => criteria({ filter: e.target.value as ProductQuery['filter'] })}>
          <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="low-stock">Low stock ≤ 10</option>
        </select></label>
        <label>Per page<select value={query.limit} onChange={e => criteria({ limit: Number(e.target.value) })}><option>10</option><option>20</option><option>50</option><option>100</option></select></label>
        <button className="secondary" disabled={tableLoading || busy} onClick={refresh}>Refresh</button>
      </div>
      <div aria-live="polite" aria-busy={tableLoading}>
        {tableLoading ? <p className="empty" role="status">Loading products…</p> : listError ? <div className="alert" role="alert">{listError} <button onClick={refresh}>Try again</button></div> :
          !list || list.data.length === 0 ? <div className="empty"><h2>No products found</h2><p>Add a product or change your search and filters.</p></div> :
            <div className="table-wrap"><table><caption className="sr-only">Products matching your search and filters</caption><thead><tr>
              <th scope="col">SKU</th><th scope="col">Name</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col">Last movement</th><th scope="col">Actions</th>
            </tr></thead><tbody>{list.data.map(product => <tr key={product.id}>
              <td>{product.sku}</td><td>{product.name}</td><td className="nowrap">{formatIDR(product.price)}</td><td><span className={product.stock <= 10 ? 'low' : ''}>{product.stock}</span></td>
              <td><span className={product.is_active ? 'badge' : 'badge inactive'}>{product.is_active ? 'Active' : 'Inactive'}</span></td>
              <td><span title={product.last_movement_at ? new Date(product.last_movement_at).toLocaleString('en-US') : undefined}>{relativeMovement(product.last_movement_at, now)}</span></td>
              <td><div className="actions"><button className="secondary" disabled={busy} aria-label={`Edit ${product.sku}`} onClick={() => { setFormError(''); setEditor({ product }) }}>Edit</button>
                <button className="secondary" disabled={busy} aria-label={`Adjustment ${product.sku}`} onClick={() => setAdjustment(product)}>Adjustment</button>
                <button className="secondary" disabled={busy} aria-label={`History ${product.sku}`} onClick={() => setHistory(product)}>History</button>
                <button className="danger" disabled={busy} aria-label={`Delete ${product.sku}`} onClick={() => void remove(product)}>{deleting === product.id ? 'Deleting…' : 'Delete'}</button></div></td>
            </tr>)}</tbody></table></div>}
      </div>
      <nav className="pagination" aria-label="Product pagination"><span>{list && !tableLoading && !listError ? `${list.total} ${list.total === 1 ? 'product' : 'products'} · Page ${query.page} of ${pages}` : '—'}</span><div className="actions">
        <button className="secondary" disabled={tableLoading || !!listError || query.page <= 1} onClick={() => { requests.current.next(); setQuery(previous => ({ ...previous, page: previous.page - 1 })) }}>Previous</button>
        <button className="secondary" disabled={tableLoading || !!listError || query.page >= pages} onClick={() => { requests.current.next(); setQuery(previous => ({ ...previous, page: previous.page + 1 })) }}>Next</button>
      </div></nav>
    </section>
    {editor && <ProductForm product={editor.product} saving={saving} error={formError} onClose={() => setEditor(null)} onSave={save} />}
    {history && <MovementHistory key={history.id} product={history} revision={revision} onClose={() => setHistory(null)} />}
    {adjustment && <StockAdjustmentModal key={adjustment.id} product={adjustment} onClose={() => setAdjustment(null)} onSuccess={result => {
      setAdjustment(null)
      setHistory(result.product)
      setNotice('Stock adjustment saved successfully.')
      refresh()
    }} />}
    </div>
  </main>
}
