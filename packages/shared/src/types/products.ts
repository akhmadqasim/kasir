// Copied from the desktop's `src/features/products/types.ts`.

export interface Product {
  id: number
  barcode: string | null
  sku: string | null
  name: string
  category_id: number | null
  buy_price: number
  sell_price: number
  margin: number
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
  margin?: number
  stock: number
  unit: string
  min_stock?: number
}

export interface UpdateProductInput extends CreateProductInput {
  id: number
}

export type ProductQuickFilter =
  | "all"
  | "low_stock"
  | "negative_stock"
  | "no_barcode"
  | "needs_review"

export interface SearchProductsParams {
  query?: string
  category_id?: number | null
  quick_filter?: Exclude<ProductQuickFilter, "all">
  page?: number
  per_page?: number
  sort_by?: string
  sort_order?: "asc" | "desc"
}

/**
 * A row of the cashier's shortcut grid: a whole product plus how it got there.
 *
 * The server flattens the product into the same object rather than nesting it,
 * so `id` is the product's id — there is no separate `product_id`.
 */
export interface ShortcutProduct extends Product {
  is_pinned: boolean
  select_count: number
}
