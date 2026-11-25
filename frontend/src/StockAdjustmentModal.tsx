import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { AdjustmentResult, Product, StockAdjustment } from './types'
import { stockError, SubmissionGate, validateAdjustment } from './stockLogic'

interface Props {
  product: Product
  onClose: () => void
  onSuccess: (result: AdjustmentResult) => void
}

export default function StockAdjustmentModal({ product, onClose, onSuccess }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const gate = useRef(new SubmissionGate())
  const [type, setType] = useState<StockAdjustment['type']>('in')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    void gate.current.run(async () => {
      const invalid = validateAdjustment(qty, note)
      setError(invalid)
      if (invalid) return
      setSaving(true)
      try {
        const result = await api.adjustStock(product.id, { type, qty: Number(qty), note })
        onSuccess(result)
      } catch (failure) { setError(stockError(failure)) }
      finally { setSaving(false) }
    })
  }

  return <dialog ref={dialog} aria-labelledby="stock-title" onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <form onSubmit={submit} noValidate aria-busy={saving}>
      <h2 id="stock-title">Stock adjustment — {product.sku}</h2>
      <p>{product.name} · Stock when opened: {product.stock}. The server validates the current stock.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      <fieldset disabled={saving}>
        <label htmlFor="stock-type">Direction</label>
        <select id="stock-type" value={type} onChange={e => setType(e.target.value as StockAdjustment['type'])}>
          <option value="in">In — stock received</option><option value="out">Out — stock removed</option>
        </select>
        <label htmlFor="stock-qty">Quantity</label>
        <input id="stock-qty" autoFocus inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} />
        <label htmlFor="stock-note">Note (optional)</label>
        <textarea id="stock-note" rows={3} value={note} onChange={e => setNote(e.target.value)} />
      </fieldset>
      <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button>
        <button disabled={saving}>{saving ? 'Saving…' : 'Save adjustment'}</button></div>
    </form>
  </dialog>
}