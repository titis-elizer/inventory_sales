import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { stockError } from './stockLogic'

// Opt-in only: creates a dedicated zero-balance product with audit history.
const origin = process.env.STOCKFLOW_TEST_API
const offline = process.env.STOCKFLOW_TEST_OFFLINE === '1'
const realFetch = globalThis.fetch
function connect() {
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => realFetch(`${origin}${path}`, init))
}
afterEach(() => vi.unstubAllGlobals())

it.skipIf(!origin || offline)('real backend: in/out, insufficient stock, last movement, summary and newest-first history', async () => {
  connect()
  const before = await api.summary()
  const product = await api.createProduct({ sku: `S6-${Date.now()}`, name: 'Stage 6 verification (zero balance)', price: 1000, is_active: true })
  expect((await api.movements(product.id)).data).toEqual([])
  const incoming = await api.adjustStock(product.id, { type: 'in', qty: 5, note: 'Stage 6 stock in verification' })
  expect(incoming.product.stock).toBe(5)
  expect(incoming.product.last_movement_at).toBe(incoming.movement.created_at)
  expect((await api.summary()).total_stock_value).toBe(before.total_stock_value + 5000)
  const outgoing = await api.adjustStock(product.id, { type: 'out', qty: 2, note: 'Stage 6 stock out verification' })
  expect(outgoing.product.stock).toBe(3)
  let failure: unknown
  try { await api.adjustStock(product.id, { type: 'out', qty: 4, note: 'Must fail' }) } catch (error) { failure = error }
  expect(failure).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK', available: 3 })
  expect(stockError(failure)).toContain('Available quantity: 3')
  const history = (await api.movements(product.id)).data
  expect(history.map(movement => movement.id)).toEqual([outgoing.movement.id, incoming.movement.id])
  const list = await api.products({ search: product.sku, page: 1, limit: 10, filter: 'all' })
  expect(list.data[0]).toMatchObject({ stock: 3, last_movement_at: outgoing.movement.created_at })
  await api.adjustStock(product.id, { type: 'out', qty: 3, note: 'Stage 6 restore zero balance' })
  expect((await api.summary()).total_stock_value).toBe(before.total_stock_value)
  console.info(`REAL_STOCK_VERIFIED sku=${product.sku} id=${product.id} (retained audit history, final stock=0)`)
}, 20000)

it.skipIf(!origin || !offline)('real stopped backend: understandable error from adjustment and history', async () => {
  connect()
  for (const action of [() => api.adjustStock(1, { type: 'in', qty: 1, note: 'Offline verification' }), () => api.movements(1)]) {
    let failure: unknown
    try { await action() } catch (error) { failure = error }
    expect(failure).toBeDefined()
    expect(stockError(failure)).toContain('Check your connection and the server')
  }
}, 15000)