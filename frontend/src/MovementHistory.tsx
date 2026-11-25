import { useEffect, useState } from 'react'
import { api } from './api'
import type { Movement, Product } from './types'
import { stockError } from './stockLogic'

export default function MovementHistory({ product, revision, onClose }: { product: Product; revision: number; onClose: () => void }) {
  const [data, setData] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api.movements(product.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result.data)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(stockError(failure))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [product.id, revision, retry])

  return <section className="panel history" aria-labelledby="history-title" aria-busy={loading}>
    <div className="toolbar"><h2 id="history-title">Movement history — {product.sku}</h2>
      <button className="secondary" disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh history</button>
      <button className="secondary" onClick={onClose}>Tutup history</button></div>
    <div aria-live="polite">{loading ? <p role="status">Memuat movement…</p> : error ?
      <div className="alert" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>Coba lagi</button></div> :
      data.length === 0 ? <p>Belum ada movement untuk produk ini.</p> :
        <div className="table-wrap"><table><caption className="sr-only">Movement terbaru dahulu</caption>
          <thead><tr><th>Waktu</th><th>Direction</th><th>Qty</th><th>Note</th></tr></thead>
          <tbody>{data.map(movement => <tr key={movement.id}>
            <td className="nowrap"><time dateTime={movement.created_at}>{new Date(movement.created_at).toLocaleString('id-ID')}</time></td>
            <td>{movement.type === 'in' ? 'In — masuk' : 'Out — keluar'}</td><td>{movement.type === 'in' ? '+' : '−'}{movement.qty}</td>
            <td className="movement-note">{movement.note || '—'}</td>
          </tr>)}</tbody></table></div>}</div>
  </section>
}