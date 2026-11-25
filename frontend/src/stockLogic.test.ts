import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { stockError, SubmissionGate, validateAdjustment } from './stockLogic'

describe('stock adjustment validation', () => {
  it.each(['', '0', '-1', '1.5', '1e3', ' 1 ', '2147483648', 'NaN', 'Infinity'])('rejects qty %s', qty => {
    expect(validateAdjustment(qty, '')).toContain('integer positif')
  })
  it.each(['1', '2147483647'])('accepts positive int32 qty %s', qty => {
    expect(validateAdjustment(qty, 'optional note')).toBe('')
  })
  it('accepts an empty note but rejects null characters', () => {
    expect(validateAdjustment('1', '')).toBe('')
    expect(validateAdjustment('1', '\0')).toContain('Note')
  })
  it.each([0, 7])('displays available quantity %s on insufficient stock', available => {
    expect(stockError(new ApiError(409, 'INSUFFICIENT_STOCK', 'insufficient', undefined, available)))
      .toBe(`Stok tidak cukup. Jumlah tersedia: ${available}.`)
  })
  it.each([0, 500, 502, 503])('explains backend unavailability (%s) and avoids blind retries', status => {
    expect(stockError(new ApiError(status, 'NETWORK_ERROR', 'failure'))).toContain('Periksa koneksi/server')
    expect(stockError(new ApiError(status, 'NETWORK_ERROR', 'failure'))).toContain('periksa history')
  })
  it('preserves other backend errors', () => {
    expect(stockError(new ApiError(409, 'STOCK_LIMIT_EXCEEDED', 'Stock limit'))).toContain('STOCK_LIMIT_EXCEEDED')
  })
})

describe('submission gate', () => {
  it('blocks simultaneous submissions and unlocks after success', async () => {
    const gate = new SubmissionGate()
    let finish!: () => void
    let calls = 0
    const first = gate.run(async () => { calls++; await new Promise<void>(resolve => { finish = resolve }) })
    await gate.run(async () => { calls++ })
    expect(calls).toBe(1)
    finish()
    await first
    await gate.run(async () => { calls++ })
    expect(calls).toBe(2)
  })
  it('unlocks after failure so the same input can be retried', async () => {
    const gate = new SubmissionGate()
    await expect(gate.run(async () => { throw new Error('offline') })).rejects.toThrow('offline')
    let retried = false
    await gate.run(async () => { retried = true })
    expect(retried).toBe(true)
  })
})