import { ApiError } from './api'

export function validateAdjustment(qty: string, note: string): string {
  if (!/^[0-9]+$/.test(qty) || Number(qty) < 1 || Number(qty) > 2147483647) {
    return 'Qty harus integer positif antara 1 dan 2147483647.'
  }
  return note.includes('\0') ? 'Note tidak boleh mengandung karakter null.' : ''
}

export function stockError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === 'INSUFFICIENT_STOCK') {
      return `Stok tidak cukup. Jumlah tersedia: ${error.available ?? 'tidak diketahui'}.`
    }
    if (error.status === 0 || error.status >= 500) {
      return 'Tidak dapat menyelesaikan permintaan ke backend. Periksa koneksi/server. Jika sedang menyimpan, periksa history sebelum mencoba lagi untuk menghindari adjustment ganda.'
    }
    return `${error.message} (${error.code})`
  }
  return 'Terjadi kesalahan. Silakan coba lagi.'
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