import type { ProductInput, ProductQuery } from './types'

export interface ProductFormValues { sku: string; name: string; price: string; is_active: boolean }
export type FormErrors = Partial<Record<'sku' | 'name' | 'price', string>>

export function validateProduct(values: ProductFormValues): FormErrors {
  const errors: FormErrors = {}
  if (!values.sku.trim() || values.sku.includes('\0')) errors.sku = 'SKU wajib diisi dan tidak boleh mengandung karakter null.'
  if (!values.name.trim() || values.name.includes('\0')) errors.name = 'Nama wajib diisi dan tidak boleh mengandung karakter null.'
  if (!/^\d+$/.test(values.price) || Number(values.price) > 2147483647) {
    errors.price = 'Harga harus integer antara 0 dan 2.147.483.647.'
  }
  return errors
}

export function productInput(values: ProductFormValues): ProductInput {
  return { sku: values.sku.trim(), name: values.name.trim(), price: Number(values.price), is_active: values.is_active }
}

export function changeCriteria(query: ProductQuery, criteria: Partial<Pick<ProductQuery, 'search' | 'filter' | 'limit'>>): ProductQuery {
  return { ...query, ...criteria, page: 1 }
}

export const pageCount = (total: number, limit: number) => Math.max(1, Math.ceil(total / limit))
export const formatIDR = (value: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(value)

export function relativeMovement(timestamp: string | null, now = Date.now()): string {
  if (!timestamp) return 'Belum ada movement'
  const date = Date.parse(timestamp)
  if (!Number.isFinite(date)) return 'Waktu tidak tersedia'
  const seconds = Math.max(0, Math.floor((now - date) / 1000))
  if (seconds < 60) return 'Baru saja'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam lalu`
  return `${Math.floor(seconds / 86400)} hari lalu`
}

// Invalidate immediately on criteria changes, before React effects run.
export class LatestRequest {
  private version = 0
  next(): number { return ++this.version }
  isCurrent(version: number): boolean { return version === this.version }
}