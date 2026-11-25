import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { hasOrderErrors, orderError, orderInput, validateOrder } from './orderLogic'

const valid = { customer: ' Customer ', items: [{ key: 1, sku: ' COF ', qty: '1' }] }
describe('order validation and normalization', () => {
  it('accepts valid input and sends no client prices or total', () => {
    expect(hasOrderErrors(validateOrder(valid))).toBe(false)
    expect(orderInput(valid)).toEqual({ customer: 'Customer', items: [{ sku: 'COF', qty: 1 }] })
  })
  it.each(['', ' ', '\0'])('rejects invalid customer %s', customer => {
    expect(validateOrder({ ...valid, customer }).customer).toBeDefined()
  })
  it('requires at least one item', () => {
    expect(validateOrder({ ...valid, items: [] }).items).toBeDefined()
  })
  it.each(['', ' ', '\0'])('rejects invalid SKU %s', sku => {
    expect(validateOrder({ ...valid, items: [{ key: 1, sku, qty: '1' }] }).rows[1].sku).toBeDefined()
  })
  it.each(['', '0', '-1', '1.1', '1e3', ' 1 ', 'NaN', 'Infinity', '2147483648'])('rejects qty %s', qty => {
    expect(validateOrder({ ...valid, items: [{ key: 1, sku: 'COF', qty }] }).rows[1].qty).toBeDefined()
  })
  it('accepts maximum int32 quantity', () => {
    expect(hasOrderErrors(validateOrder({ ...valid, items: [{ key: 1, sku: 'COF', qty: '2147483647' }] }))).toBe(false)
  })
  it('marks both duplicate SKU rows after trimming', () => {
    const errors = validateOrder({ ...valid, items: [valid.items[0], { key: 2, sku: 'COF', qty: '2' }] })
    expect(errors.rows[1].sku).toContain('Duplicate SKU')
    expect(errors.rows[2].sku).toContain('Duplicate SKU')
  })
  it('keeps SKU uniqueness case-sensitive like the backend', () => {
    expect(hasOrderErrors(validateOrder({ ...valid, items: [valid.items[0], { key: 2, sku: 'cof', qty: '2' }] }))).toBe(false)
  })
})
describe('order backend errors', () => {
  it('retains backend 400 validation message', () => {
    expect(orderError(new ApiError(400, 'VALIDATION_ERROR', 'customer is required')).message).toContain('customer is required')
  })
  it.each([0, 3])('identifies exact SKU and available quantity %s', available => {
    expect(orderError(new ApiError(409, 'INSUFFICIENT_STOCK', 'Insufficient stock', 'COF', available)))
      .toEqual({ sku: 'COF', message: `Insufficient stock (INSUFFICIENT_STOCK) Available quantity: ${available}.` })
  })
  it('warns against blindly resubmitting an ambiguous create', () => {
    expect(orderError(new ApiError(0, 'NETWORK_ERROR', 'offline')).message).toContain('do not blindly submit again')
  })
})