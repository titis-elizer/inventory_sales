import type { Product, ProductInput, ProductList, ProductQuery, ProductSummary } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly sku?: string
  readonly available?: number

  constructor(status: number, code: string, message: string, sku?: string, available?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.sku = sku
    this.available = available
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseApiError(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {}
  return new ApiError(status,
    typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
    typeof error.message === 'string' ? error.message : `Permintaan gagal (HTTP ${status}).`,
    typeof error.sku === 'string' ? error.sku : undefined,
    typeof error.available === 'number' ? error.available : undefined)
}

export function productQueryString(query: ProductQuery): string {
  return new URLSearchParams({ search: query.search, filter: query.filter,
    page: String(query.page), limit: String(query.limit) }).toString()
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'Tidak dapat terhubung ke server. Periksa koneksi dan backend.')
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw parseApiError(response.status, body)
  }
  if (response.status === 204) return undefined as T
  try { return await response.json() as T } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Respons server bukan JSON yang valid.')
  }
}

const jsonBody = (method: string, input: ProductInput): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})

export const api = {
  products: (query: ProductQuery, signal?: AbortSignal) =>
    request<ProductList>(`/products?${productQueryString(query)}`, { signal }),
  summary: (signal?: AbortSignal) => request<ProductSummary>('/products/summary', { signal }),
  createProduct: (input: ProductInput) => request<Product>('/products', jsonBody('POST', input)),
  updateProduct: (id: number, input: ProductInput) => request<Product>(`/products/${id}`, jsonBody('PUT', input)),
  deleteProduct: (id: number) => request<void>(`/products/${id}`, { method: 'DELETE' }),
}
