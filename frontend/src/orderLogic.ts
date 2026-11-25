import { ApiError } from './api'
import type { OrderInput } from './types'

export interface OrderRow { key: number; sku: string; qty: string }
export interface OrderValues { customer: string; items: OrderRow[] }
export interface OrderErrors {
  customer?: string
  items?: string
  rows: Record<number, { sku?: string; qty?: string }>
}

export function validateOrder(values: OrderValues): OrderErrors {
  const errors: OrderErrors = { rows: {} }
  if (!values.customer.trim() || values.customer.includes('\0')) {
    errors.customer = 'Customer name is required and must not contain null characters.'
  }
  if (values.items.length === 0) errors.items = 'Add at least one item.'
  const seen = new Map<string, number>()
  for (const row of values.items) {
    const itemError: { sku?: string; qty?: string } = {}
    const sku = row.sku.trim()
    if (!sku || sku.includes('\0')) itemError.sku = 'Select a valid SKU.'
    if (!/^[0-9]+$/.test(row.qty) || Number(row.qty) < 1 || Number(row.qty) > 2147483647) {
      itemError.qty = 'Quantity must be a positive integer between 1 and 2,147,483,647.'
    }
    if (sku && seen.has(sku)) {
      itemError.sku = `Duplicate SKU: ${sku}.`
      const first = seen.get(sku)!
      errors.rows[first] = { ...errors.rows[first], sku: itemError.sku }
    } else seen.set(sku, row.key)
    if (Object.keys(itemError).length) errors.rows[row.key] = itemError
  }
  return errors
}

export function hasOrderErrors(errors: OrderErrors): boolean {
  return !!errors.customer || !!errors.items || Object.keys(errors.rows).length > 0
}

export function orderInput(values: OrderValues): OrderInput {
  return { customer: values.customer.trim(), items: values.items.map(row => ({ sku: row.sku.trim(), qty: Number(row.qty) })) }
}

export function orderError(error: unknown): { message: string; sku?: string } {
  if (!(error instanceof ApiError)) return { message: 'Something went wrong. Please try again.' }
  if (error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE') {
    return { message: 'Unable to complete the request. Check your connection and the server. The order may already have been processed; do not blindly submit again. If an order ID is known, refresh its detail to check the status.' }
  }
  return {
    message: `${error.message} (${error.code})${error.available !== undefined ? ` Available quantity: ${error.available}.` : ''}`,
    sku: error.sku,
  }
}