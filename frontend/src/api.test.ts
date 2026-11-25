import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, parseApiError, productQueryString } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('API client', () => {
  it('preserves code, message, sku, and available including zero', () => {
    const error = parseApiError(409, { error: { code: 'INSUFFICIENT_STOCK', message: 'Stok kurang', sku: 'COF', available: 0 } })
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK', message: 'Stok kurang', sku: 'COF', available: 0 })
  })
  it('handles non-JSON error bodies safely', () => {
    expect(parseApiError(502, '<html>bad gateway</html>')).toMatchObject({ code: 'HTTP_ERROR', status: 502 })
  })
  it('encodes search and parameters centrally', () => {
    const params = new URLSearchParams(productQueryString({ search: 'kopi & teh', page: 2, limit: 10, filter: 'low-stock' }))
    expect(params.get('search')).toBe('kopi & teh')
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