import { describe, expect, it } from 'vitest'
import { changeCriteria, formatIDR, LatestRequest, pageCount, productInput, relativeMovement, validateProduct } from './productLogic'
import type { ProductFormValues } from './productLogic'

const valid: ProductFormValues = { sku: ' COF-01 ', name: ' Coffee ', price: '0', is_active: true }

describe('product validation', () => {
  it('accepts zero and normalizes strings without a stock field', () => {
    expect(validateProduct(valid)).toEqual({})
    expect(productInput(valid)).toEqual({ sku: 'COF-01', name: 'Coffee', price: 0, is_active: true })
  })
  it.each(['', '-1', '1.5', '1e3', 'NaN', '2147483648', ' 1 '])('rejects invalid price %s', price => {
    expect(validateProduct({ ...valid, price }).price).toBeDefined()
  })
  it('requires sku/name and rejects null characters', () => {
    expect(validateProduct({ ...valid, sku: ' ', name: '\0' })).toHaveProperty('sku')
    expect(validateProduct({ ...valid, name: '\0' })).toHaveProperty('name')
  })
})

describe('paging, time, formatting and request ordering', () => {
  it('resets page on search, filter, or limit changes', () => {
    const query = { search: '', filter: 'all' as const, page: 5, limit: 10 }
    expect(changeCriteria(query, { search: 'tea' }).page).toBe(1)
    expect(changeCriteria(query, { filter: 'active' }).page).toBe(1)
    expect(changeCriteria(query, { limit: 20 }).page).toBe(1)
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(21, 10)).toBe(3)
  })
  it('does not accept an old response after a new request or invalidation', () => {
    const gate = new LatestRequest()
    const old = gate.next()
    const current = gate.next()
    expect(gate.isCurrent(old)).toBe(false)
    expect(gate.isCurrent(current)).toBe(true)
    gate.next()
    expect(gate.isCurrent(current)).toBe(false)
  })
  it('formats IDR and relative movement', () => {
    const now = Date.parse('2026-01-02T12:00:00Z')
    expect(formatIDR(1234567)).toContain('1,234,567')
    expect(formatIDR(1234567)).toContain('IDR')
    expect(relativeMovement(null, now)).toBe('No movements yet')
    expect(relativeMovement('invalid', now)).toBe('Time unavailable')
    expect(relativeMovement('2026-01-02T12:00:00Z', now)).toBe('Just now')
    expect(relativeMovement('2026-01-02T10:00:00Z', now)).toBe('2 hours ago')
    expect(relativeMovement('2026-01-02T11:59:00Z', now)).toBe('1 minute ago')
    expect(relativeMovement('2026-01-02T11:58:00Z', now)).toBe('2 minutes ago')
    expect(relativeMovement('2026-01-02T11:00:00Z', now)).toBe('1 hour ago')
    expect(relativeMovement('2026-01-01T12:00:00Z', now)).toBe('1 day ago')
    expect(relativeMovement('2025-12-31T12:00:00Z', now)).toBe('2 days ago')
  })
})