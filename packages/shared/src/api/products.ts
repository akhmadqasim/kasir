import type {
  Category,
  CreateProductInput,
  PaginatedProducts,
  Product,
  SearchProductsParams,
  UpdateProductInput,
} from "../types/products"
import type { ApiClient, QueryParams } from "./client"

/**
 * Products and categories.
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

/**
 * The field a stock count or a price edit is allowed to change. Everything else
 * is carried over from the product as it is, because the server has no partial
 * update: `PUT /products/{id}` overwrites the whole row.
 */
export type ProductPatch = Partial<
  Pick<Product, "sell_price" | "buy_price" | "min_stock" | "stock" | "category_id">
>

/** Just enough of a product to find it again. See {@link createProductsApi} `refetch`. */
export type ProductLookupHint = Pick<Product, "id" | "name" | "barcode">

/** The full body `PUT /products/{id}` expects, built from a product plus a patch. */
export function toUpdateInput(product: Product, patch: ProductPatch): UpdateProductInput {
  return {
    id: product.id,
    barcode: product.barcode,
    sku: product.sku,
    name: product.name,
    category_id: patch.category_id !== undefined ? patch.category_id : product.category_id,
    buy_price: patch.buy_price ?? product.buy_price,
    sell_price: patch.sell_price ?? product.sell_price,
    margin: product.margin,
    stock: patch.stock ?? product.stock,
    unit: product.unit,
    min_stock: patch.min_stock ?? product.min_stock,
  }
}

export function createProductsApi(client: ApiClient) {
  const update = (input: UpdateProductInput): Promise<Product> =>
    client.put<Product>(`/products/${input.id}`, input)

  return {
    search(params: SearchProductsParams): Promise<PaginatedProducts> {
      return client.get<PaginatedProducts>("/products", searchQuery(params))
    },

    /** `null` when no active product carries this barcode. */
    getByBarcode(barcode: string): Promise<Product | null> {
      return client.get<Product | null>(`/products/barcode/${encodeURIComponent(barcode)}`)
    },

    /**
     * Re-read one product the caller has already seen once.
     *
     * There is no `GET /products/{id}` (listed under backend gaps in
     * `apps/mobile/README.md`), and `query` matches name, barcode and SKU but
     * never the id. So the lookup goes by barcode when the product has one and
     * by exact name otherwise, and the id is checked on whatever comes back so
     * a renamed or re-labelled product cannot be mistaken for another.
     */
    async refetch(hint: ProductLookupHint): Promise<Product | null> {
      if (hint.barcode) {
        const byBarcode = await client.get<Product | null>(
          `/products/barcode/${encodeURIComponent(hint.barcode)}`,
        )
        if (byBarcode?.id === hint.id) return byBarcode
      }

      const page = await client.get<PaginatedProducts>(
        "/products",
        searchQuery({ query: hint.name, page: 1, per_page: 50 }),
      )
      return page.data.find((product) => product.id === hint.id) ?? null
    },

    /** Admin only, enforced by the service. */
    create(input: CreateProductInput): Promise<Product> {
      return client.post<Product>("/products", input)
    },

    /**
     * Admin only. The id travels twice: in the path, which is what the server
     * acts on, and in the body, because `UpdateProductInput` declares it. The
     * handler overwrites the body's copy with the path's.
     */
    update,

    /** Admin only. Price and threshold edits, everything else carried over. */
    patch(product: Product, patch: ProductPatch): Promise<Product> {
      return update(toUpdateInput(product, patch))
    },

    /**
     * Set a product's stock to what was physically counted.
     *
     * The server has no stock-adjustment endpoint, so this is the whole-row
     * `PUT` with `stock` replaced — which is why it is admin-only and leaves
     * no audit row behind. A dedicated `POST /api/stock/adjustments` that
     * records who counted what, and lets a cashier count too, is listed under
     * backend gaps in `apps/mobile/README.md`.
     */
    adjustStock(product: Product, countedStock: number): Promise<Product> {
      return update(toUpdateInput(product, { stock: countedStock }))
    },

    listCategories(): Promise<Category[]> {
      return client.get<Category[]>("/categories")
    },
  }
}

export type ProductsApi = ReturnType<typeof createProductsApi>
