export interface Product {
  id: number
  barcode: string | null
  sku: string | null
  name: string
  category_id: number | null
  buy_price: number
  sell_price: number
  stock: number
  unit: string
  min_stock: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface PaginatedProducts {
  data: Product[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface CreateProductInput {
  barcode?: string | null
  sku?: string | null
  name: string
  category_id?: number | null
  buy_price: number
  sell_price: number
  stock: number
  unit: string
  min_stock?: number
}

export interface UpdateProductInput extends CreateProductInput {
  id: number
}

export interface SearchProductsParams {
  query?: string
  category_id?: number | null
  page?: number
  per_page?: number
}
