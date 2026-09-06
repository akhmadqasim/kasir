import type {
  BulkImportResult,
  BulkProductInput,
  CreateProductInput,
  PaginatedProducts,
  Product,
  SearchProductsParams,
  ShortcutProduct,
  UpdateProductInput,
} from "@/features/products/types"
import {
  apiDelete,
  apiDownload,
  apiGet,
  apiPost,
  apiPut,
  type QueryParams,
} from "./client"

/**
 * Products.
 *
 * The search parameters go on the query string in the names the Rust
 * `ProductSearchParams` declares — snake_case, because that struct has no
 * `rename_all`. Getting this wrong does not fail loudly: serde treats an
 * unknown parameter as absent, so a mis-cased `per_page` would silently page by
 * the default instead of by what the screen asked for.
 */

function searchQuery(params: SearchProductsParams): QueryParams {
  return {
    query: params.query,
    category_id: params.category_id,
    quick_filter: params.quick_filter,
    page: params.page,
    per_page: params.per_page,
    sort_by: params.sort_by,
    sort_order: params.sort_order,
  }
}

export function searchProducts(params: SearchProductsParams): Promise<PaginatedProducts> {
  return apiGet<PaginatedProducts>("/products", searchQuery(params))
}

export function getProductByBarcode(barcode: string): Promise<Product | null> {
  return apiGet<Product | null>(`/products/barcode/${encodeURIComponent(barcode)}`)
}

export function getPopularProducts(limit: number): Promise<ShortcutProduct[]> {
  return apiGet<ShortcutProduct[]>("/products/popular", { limit })
}

/** Bump a product's selection counter so the shortcut grid learns what sells. */
export function trackProductSelection(productId: number): Promise<void> {
  return apiPost<void>(`/products/${productId}/select`)
}

/** Returns the pin state *after* toggling. */
export function toggleProductPin(productId: number): Promise<boolean> {
  return apiPost<boolean>(`/products/${productId}/pin`)
}

export function createProduct(input: CreateProductInput): Promise<Product> {
  return apiPost<Product>("/products", input)
}

/**
 * The id travels twice: in the path, which is what the server acts on, and in
 * the body, because `UpdateProductInput` declares it as a required field. The
 * handler overwrites the body's copy with the path's, so the two cannot
 * disagree about which row is being written.
 */
export function updateProduct(input: UpdateProductInput): Promise<Product> {
  return apiPut<Product>(`/products/${input.id}`, input)
}

export function deleteProduct(productId: number): Promise<void> {
  return apiDelete<void>(`/products/${productId}`)
}

export function bulkCreateProducts(products: BulkProductInput[]): Promise<BulkImportResult> {
  return apiPost<BulkImportResult>("/products/bulk", products)
}

/**
 * Download the CSV template for bulk import.
 *
 * The old command wrote the file to the user's Desktop from content the webview
 * supplied, which is a path the client controlled. The server now generates and
 * serves it, so there is no filesystem write left on this side at all.
 */
export function downloadImportTemplate(): Promise<string> {
  return apiDownload("/products/import-template", "template-import-produk.csv")
}
