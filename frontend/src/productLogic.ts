import type { ProductInput, ProductQuery } from './types'

export interface ProductFormValues { sku: string; name: string; price: string; is_active: boolean }
export type FormErrors = Partial<Record<'sku' | 'name' | 'price', string>>

export function validateProduct(values: ProductFormValues): FormErrors {
  const errors: FormErrors = {}
  if (!values.sku.trim() || values.sku.includes('\0')) errors.sku = 'SKU is required and must not contain null characters.'
  if (!values.name.trim() || values.name.includes('\0')) errors.name = 'Name is required and must not contain null characters.'
  if (!/^\d+$/.test(values.price) || Number(values.price) > 2147483647) {
    errors.price = 'Price must be a whole number between 0 and 2,147,483,647.'
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
export const formatIDR = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(value)

export function relativeMovement(timestamp: string | null, now = Date.now()): string {
  if (!timestamp) return 'No movements yet'
  const date = Date.parse(timestamp)
  if (!Number.isFinite(date)) return 'Time unavailable'
  const seconds = Math.max(0, Math.floor((now - date) / 1000))
  if (seconds < 60) return 'Just now'
  const [amount, unit] = seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] as const
    : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] as const
      : [Math.floor(seconds / 86400), 'day'] as const
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`
}

// Invalidate immediately on criteria changes, before React effects run.
export class LatestRequest {
  private version = 0
  next(): number { return ++this.version }
  isCurrent(version: number): boolean { return version === this.version }
}