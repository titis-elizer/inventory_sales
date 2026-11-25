import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { orderError } from './orderLogic'

const origin = process.env.STOCKFLOW_ORDER_TEST_API
const realFetch = globalThis.fetch
afterEach(() => vi.unstubAllGlobals())

it.skipIf(!origin)('real backend: create/detail, stock conflict, cancel and restored products/summary', async () => {
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => realFetch(`${origin}${path}`, init))
  const product = await api.createProduct({ sku: `S7-${Date.now()}`, name: 'Stage 7 order verification', price: 1200, is_active: true })
  await api.adjustStock(product.id, { type: 'in', qty: 3, note: 'Stage 7 verification funding' })
  const before = await api.summary()
  const input = { customer: 'Stage 7 verification', items: [{ sku: product.sku, qty: 2 }] }
  const order = await api.createOrder(input)
  expect(order.total).toBe(2400)
  expect(order.items[0]).toMatchObject({ sku: product.sku, qty: 2, unit_price: 1200 })
  expect(await api.order(order.id)).toEqual(order)
  const query = { search: product.sku, filter: 'all' as const, page: 1, limit: 10 }
  expect((await api.products(query)).data[0].stock).toBe(1)
  expect((await api.summary()).total_stock_value).toBe(before.total_stock_value - 2400)
  let conflict: unknown
  try { await api.createOrder(input) } catch (error) { conflict = error }
  expect(conflict).toMatchObject({ status: 409, sku: product.sku, available: 1 })
  expect(orderError(conflict)).toMatchObject({ sku: product.sku })
  expect(orderError(conflict).message).toContain('Available quantity: 1')
  const cancelled = await api.cancelOrder(order.id)
  expect(cancelled.status).toBe('CANCELLED')
  expect(cancelled.cancelled_at).not.toBeNull()
  expect((await api.order(order.id)).status).toBe('CANCELLED')
  expect((await api.products(query)).data[0].stock).toBe(3)
  expect((await api.summary()).total_stock_value).toBe(before.total_stock_value)
  await api.adjustStock(product.id, { type: 'out', qty: 3, note: 'Stage 7 restore zero balance' })
  console.info(`REAL_ORDER_VERIFIED order=${order.id} sku=${product.sku} cancelled=true finalStock=0`)
}, 20000)