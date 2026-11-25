export interface Product {
  id: number
  sku: string
  name: string
  price: number
  stock: number
  is_active: boolean
  created_at: string
  last_movement_at: string | null
}

export interface ProductInput {
  sku: string
  name: string
  price: number
  is_active: boolean
}

export type ProductFilter = 'all' | 'active' | 'inactive' | 'low-stock'
export interface ProductQuery {
  search: string
  filter: ProductFilter
  page: number
  limit: number
}
export interface ProductList {
  data: Product[]
  page: number
  limit: number
  total: number
}
export interface ProductSummary {
  total_products: number
  active_products: number
  total_stock_value: number
  low_stock_count: number
}

export interface StockAdjustment {
  type: 'in' | 'out'
  qty: number
  note: string
}
export interface Movement {
  id: number
  product_id: number
  type: 'in' | 'out'
  qty: number
  note: string | null
  created_at: string
}
export interface AdjustmentResult {
  product: Product
  movement: Movement
}