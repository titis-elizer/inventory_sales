import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Product, ProductInput } from './types'
import { productInput, validateProduct } from './productLogic'
import type { FormErrors, ProductFormValues } from './productLogic'

interface Props {
  product: Product | null
  saving: boolean
  error: string
  onClose: () => void
  onSave: (input: ProductInput) => Promise<void>
}

export default function ProductForm({ product, saving, error, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState<ProductFormValues>({ sku: product?.sku ?? '', name: product?.name ?? '',
    price: product ? String(product.price) : '', is_active: product?.is_active ?? true })
  const [errors, setErrors] = useState<FormErrors>({})
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  function submit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = validateProduct(values)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length === 0) void onSave(productInput(values))
  }
  return <dialog ref={dialog} aria-labelledby="form-title" onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <form onSubmit={submit} noValidate>
      <h2 id="form-title">{product ? 'Edit produk' : 'Tambah produk'}</h2>
      <p>Stok tidak diubah melalui form ini. SKU yang sudah dipakai order tidak dapat diganti.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      <fieldset disabled={saving}>
        <label htmlFor="sku">SKU</label>
        <input id="sku" autoFocus value={values.sku} onChange={e => setValues({ ...values, sku: e.target.value })} aria-invalid={!!errors.sku} aria-describedby={errors.sku ? 'sku-error' : undefined} />
        {errors.sku && <small id="sku-error" className="field-error">{errors.sku}</small>}
        <label htmlFor="name">Nama produk</label>
        <input id="name" value={values.name} onChange={e => setValues({ ...values, name: e.target.value })} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined} />
        {errors.name && <small id="name-error" className="field-error">{errors.name}</small>}
        <label htmlFor="price">Harga (IDR)</label>
        <input id="price" inputMode="numeric" value={values.price} onChange={e => setValues({ ...values, price: e.target.value })} aria-invalid={!!errors.price} aria-describedby={errors.price ? 'price-error' : undefined} />
        {errors.price && <small id="price-error" className="field-error">{errors.price}</small>}
        <label className="checkbox"><input type="checkbox" checked={values.is_active} onChange={e => setValues({ ...values, is_active: e.target.checked })} />Produk aktif</label>
      </fieldset>
      <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Batal</button><button disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button></div>
    </form>
  </dialog>
}