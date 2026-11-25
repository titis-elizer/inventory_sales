import { ApiError } from './api'

export function validateAdjustment(qty: string, note: string): string {
  if (!/^[0-9]+$/.test(qty) || Number(qty) < 1 || Number(qty) > 2147483647) {
    return 'Quantity must be a positive integer between 1 and 2,147,483,647.'
  }
  return note.includes('\0') ? 'Note must not contain null characters.' : ''
}

export function stockError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === 'INSUFFICIENT_STOCK') {
      return `Insufficient stock. Available quantity: ${error.available ?? 'unknown'}.`
    }
    if (error.status === 0 || error.status >= 500) {
      return 'Unable to complete the backend request. Check your connection and the server. If you were saving, check movement history before retrying to avoid a duplicate adjustment.'
    }
    return `${error.message} (${error.code})`
  }
  return 'Something went wrong. Please try again.'
}

// Synchronous lock: a second submit cannot enter before React renders disabled controls.
export class SubmissionGate {
  private saving = false
  async run(action: () => Promise<void>): Promise<void> {
    if (this.saving) return
    this.saving = true
    try { await action() } finally { this.saving = false }
  }
}