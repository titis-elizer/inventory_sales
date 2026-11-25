import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { Product, ProductInput, ProductList, ProductQuery, ProductSummary } from './types'
import { changeCriteria, formatIDR, LatestRequest, pageCount, relativeMovement } from './productLogic'
import ProductForm from './ProductForm'
import './style.css'

const errorMessage = (error: unknown) => error instanceof ApiError
  ? `${error.message} (${error.code})` : 'Terjadi kesalahan. Silakan coba lagi.'

export default function App() {
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
      setNotice('Produk berhasil disimpan.')
      refresh()
    } catch (error) { setFormError(errorMessage(error)) } finally { setSaving(false) }
  }

  async function remove(product: Product) {
    if (busy || !window.confirm(`Hapus ${product.sku} — ${product.name}? Tindakan ini tidak dapat dibatalkan.`)) return
    setDeleting(product.id)
    setMutationError('')
    setNotice('')
    try {
      await api.deleteProduct(product.id)
      setNotice('Produk berhasil dihapus.')
      refresh()
    } catch (error) { setMutationError(errorMessage(error)) } finally { setDeleting(null) }
  }

  const pages = list ? pageCount(list.total, query.limit) : 1
  const pendingSearch = search.trim() !== query.search
  const tableLoading = loading || pendingSearch
  return <main className="container">
    <header><div><p className="eyebrow">STOCKFLOW</p><h1>Produk & persediaan</h1><p>Kelola katalog produk dan pantau stok gudang.</p></div>
      <button disabled={busy} onClick={() => { setFormError(''); setEditor({ product: null }) }}>+ Tambah produk</button></header>
    {notice && <div className="notice" role="status">{notice}</div>}
    {mutationError && <div className="alert" role="alert">{mutationError} <button className="secondary" onClick={() => setMutationError('')}>Tutup</button></div>}
    <section aria-label="Ringkasan global" aria-busy={summaryLoading}>
      {summaryError ? <div className="alert" role="alert">Ringkasan gagal: {summaryError} <button onClick={refresh}>Coba lagi</button></div> :
        <div className="stats">{[
          ['Total produk', summary?.total_products], ['Produk aktif', summary?.active_products],
          ['Nilai seluruh stok', summary ? formatIDR(summary.total_stock_value) : undefined], ['Stok rendah (≤ 10)', summary?.low_stock_count],
        ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{summaryLoading ? '…' : value ?? '—'}</strong></article>)}</div>}
    </section>
    <section className="panel" aria-label="Daftar produk">
      <div className="toolbar">
        <label>Cari SKU atau nama<input type="search" value={search} onChange={event => {
          requests.current.next()
          setLoading(true)
          setSearch(event.target.value)
          if (query.page !== 1) setQuery(previous => ({ ...previous, page: 1 }))
        }} placeholder="Contoh: kopi" /></label>
        <label>Filter<select value={query.filter} onChange={e => criteria({ filter: e.target.value as ProductQuery['filter'] })}>
          <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="low-stock">Low stock ≤ 10</option>
        </select></label>
        <label>Per halaman<select value={query.limit} onChange={e => criteria({ limit: Number(e.target.value) })}><option>10</option><option>20</option><option>50</option><option>100</option></select></label>
        <button className="secondary" disabled={tableLoading || busy} onClick={refresh}>Refresh</button>
      </div>
      <div aria-live="polite" aria-busy={tableLoading}>
        {tableLoading ? <p className="empty" role="status">Memuat produk…</p> : listError ? <div className="alert" role="alert">{listError} <button onClick={refresh}>Coba lagi</button></div> :
          !list || list.data.length === 0 ? <div className="empty"><h2>Tidak ada produk</h2><p>Tambahkan produk atau ubah pencarian dan filter.</p></div> :
            <div className="table-wrap"><table><caption className="sr-only">Produk sesuai pencarian dan filter</caption><thead><tr>
              <th scope="col">SKU</th><th scope="col">Nama</th><th scope="col">Harga</th><th scope="col">Stok</th><th scope="col">Status</th><th scope="col">Movement terakhir</th><th scope="col">Actions</th>
            </tr></thead><tbody>{list.data.map(product => <tr key={product.id}>
              <td>{product.sku}</td><td>{product.name}</td><td className="nowrap">{formatIDR(product.price)}</td><td><span className={product.stock <= 10 ? 'low' : ''}>{product.stock}</span></td>
              <td><span className={product.is_active ? 'badge' : 'badge inactive'}>{product.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
              <td><span title={product.last_movement_at ? new Date(product.last_movement_at).toLocaleString('id-ID') : undefined}>{relativeMovement(product.last_movement_at, now)}</span></td>
              <td><div className="actions"><button className="secondary" disabled={busy} aria-label={`Edit ${product.sku}`} onClick={() => { setFormError(''); setEditor({ product }) }}>Edit</button>
                <button className="danger" disabled={busy} aria-label={`Hapus ${product.sku}`} onClick={() => void remove(product)}>{deleting === product.id ? 'Menghapus…' : 'Hapus'}</button></div></td>
            </tr>)}</tbody></table></div>}
      </div>
      <nav className="pagination" aria-label="Pagination produk"><span>{list && !tableLoading && !listError ? `${list.total} produk · Halaman ${query.page} dari ${pages}` : '—'}</span><div className="actions">
        <button className="secondary" disabled={tableLoading || !!listError || query.page <= 1} onClick={() => { requests.current.next(); setQuery(previous => ({ ...previous, page: previous.page - 1 })) }}>Sebelumnya</button>
        <button className="secondary" disabled={tableLoading || !!listError || query.page >= pages} onClick={() => { requests.current.next(); setQuery(previous => ({ ...previous, page: previous.page + 1 })) }}>Berikutnya</button>
      </div></nav>
    </section>
    {editor && <ProductForm product={editor.product} saving={saving} error={formError} onClose={() => setEditor(null)} onSave={save} />}
  </main>
}
