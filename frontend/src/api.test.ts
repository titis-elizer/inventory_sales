import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, parseApiError, productQueryString } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('API client', () => {
  it('creates, reads and cancels orders through the existing endpoints only', async () => {
    const order = { id: 12, total: 9876, items: [{ sku: 'COF', unit_price: 4938, qty: 2 }], status: 'CREATED' }
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(order))))
    vi.stubGlobal('fetch', fetchMock)
    const input = { customer: 'Customer', items: [{ sku: 'COF', qty: 2 }] }
    await expect(api.createOrder(input)).resolves.toEqual(order)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    const signal = new AbortController().signal
    await expect(api.order(12, signal)).resolves.toEqual(order)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/orders/12', { signal })
    await expect(api.cancelOrder(12)).resolves.toEqual(order)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/orders/12/cancel', { method: 'POST' })
  })
  it('posts stock direction, qty, and note to the centralized stock endpoint', async () => {
    const result = { product: { id: 3, stock: 4 }, movement: { id: 8, type: 'in', qty: 4 } }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.adjustStock(3, { type: 'in', qty: 4, note: 'Receipt' })).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('/api/products/3/stock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'in', qty: 4, note: 'Receipt' }),
    })
  })
  it('loads movements with abort support and preserves newest-first API ordering', async () => {
    const data = [{ id: 8 }, { id: 7 }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data })))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    await expect(api.movements(3, signal)).resolves.toEqual({ data })
    expect(fetchMock).toHaveBeenCalledWith('/api/products/3/movements', { signal })
  })
  it('preserves code, message, sku, and available including zero', () => {
    const error = parseApiError(409, { error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock', sku: 'COF', available: 0 } })
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock', sku: 'COF', available: 0 })
  })
  it('handles non-JSON error bodies safely', () => {
    expect(parseApiError(502, '<html>bad gateway</html>')).toMatchObject({ code: 'HTTP_ERROR', status: 502 })
  })
  it('encodes search and parameters centrally', () => {
    const params = new URLSearchParams(productQueryString({ search: 'coffee & tea', page: 2, limit: 10, filter: 'low-stock' }))
    expect(params.get('search')).toBe('coffee & tea')
    expect(params.get('page')).toBe('2')
    expect(params.get('filter')).toBe('low-stock')
  })
  it('accepts empty 204 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.deleteProduct(3)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/products/3', { method: 'DELETE' })
  })
  it('throws a typed backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PRODUCT_HAS_HISTORY', message: 'Cannot delete' } }), { status: 409 })))
    await expect(api.deleteProduct(3)).rejects.toMatchObject({ code: 'PRODUCT_HAS_HISTORY', message: 'Cannot delete' })
  })
  it('wraps network failure and preserves abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.summary()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    await expect(api.summary()).rejects.toMatchObject({ name: 'AbortError' })
  })
})