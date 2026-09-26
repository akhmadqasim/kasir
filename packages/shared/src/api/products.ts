import type {
  Category,
  CreateProductInput,
  PaginatedProducts,
  Product,
  SearchProductsParams,
  UpdateProductInput,
} from "../types/products"
import { id } from "../i18n/id"
import { ApiError, type ApiClient, type QueryParams } from "./client"

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
 * is carried over from the product as the server has it right now, because the
 * server has no partial update: `PUT /products/{id}` overwrites the whole row,
 * except stock, which it only touches when the body carries it.
 */
export type ProductPatch = Partial<
  Pick<Product, "sell_price" | "buy_price" | "min_stock" | "stock" | "category_id">
>

/** Just enough of a product to find it again. See {@link createProductsApi} `refetch`. */
export type ProductLookupHint = Pick<Product, "id" | "name" | "barcode">

/**
 * The body `PUT /products/{id}` expects, built from a product plus a patch.
 *
 * Stock is left out unless the patch changes it, and a changed stock goes with
 * `expected_stock` — the value it was based on — so the server applies the
 * difference to the current stock and keeps sales made in the meantime.
 */
function toUpdateInput(product: Product, patch: ProductPatch): UpdateProductInput {
  const stockChange =
    patch.stock !== undefined && patch.stock !== product.stock
      ? { stock: patch.stock, expected_stock: product.stock }
      : {}
  return {
    ...stockChange,
    id: product.id,
    barcode: product.barcode,
    sku: product.sku,
    name: product.name,
    category_id: patch.category_id !== undefined ? patch.category_id : product.category_id,
    buy_price: patch.buy_price ?? product.buy_price,
    sell_price: patch.sell_price ?? product.sell_price,
    margin: product.margin,
    unit: product.unit,
    min_stock: patch.min_stock ?? product.min_stock,
  }
}

/** Rows per request when {@link createProductsApi} `refetch` falls back to a name search. */
const REFETCH_PAGE_SIZE = 200

export function createProductsApi(client: ApiClient) {
  const update = (input: UpdateProductInput): Promise<Product> =>
    client.put<Product>(`/products/${input.id}`, input)

  /**
   * Re-read one product the caller has already seen once.
   *
   * There is no `GET /products/{id}` (listed under backend gaps in
   * `apps/mobile/README.md`), and `query` matches name, barcode and SKU but
   * never the id. So the lookup goes by barcode when the product has one and
   * by name otherwise, paging until the id turns up — a common name like
   * "Gula" can match more rows than one page holds. The id is checked on
   * whatever comes back so a renamed or re-labelled product cannot be mistaken
   * for another.
   */
  const refetch = async (hint: ProductLookupHint): Promise<Product | null> => {
    if (hint.barcode) {
      const byBarcode = await client.get<Product | null>(
        `/products/barcode/${encodeURIComponent(hint.barcode)}`,
      )
      if (byBarcode?.id === hint.id) return byBarcode
    }

    for (let page = 1; ; page += 1) {
      const result = await client.get<PaginatedProducts>(
        "/products",
        searchQuery({
          query: hint.name,
          page,
          per_page: REFETCH_PAGE_SIZE,
          sort_by: "name",
          sort_order: "asc",
        }),
      )
      const match = result.data.find((product) => product.id === hint.id)
      if (match) return match
      if (page >= result.total_pages) return null
    }
  }

  /**
   * The whole-row `PUT` with `patch` applied to the row as the server has it
   * now, not as the caller cached it — otherwise a price edit made from a
   * list loaded minutes ago would write that list's stock back over every sale
   * the desktop has made since.
   */
  const updateFresh = async (product: Product, patch: ProductPatch): Promise<Product> => {
    const current = await refetch(product)
    if (!current) throw new ApiError("not_found", id.scan.notFound, 404)
    return update(toUpdateInput(current, patch))
  }

  return {
    search(params: SearchProductsParams): Promise<PaginatedProducts> {
      return client.get<PaginatedProducts>("/products", searchQuery(params))
    },

    /** `null` when no active product carries this barcode. */
    getByBarcode(barcode: string): Promise<Product | null> {
      return client.get<Product | null>(`/products/barcode/${encodeURIComponent(barcode)}`)
    },

    refetch,

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
      return updateFresh(product, patch)
    },

    /**
     * Set a product's stock to what was physically counted.
     *
     * The server has no stock-adjustment endpoint, so this is the whole-row
     * `PUT` with `stock` + `expected_stock` (the re-read system stock), which
     * the server applies as a difference so a sale landing between the re-read
     * and the write is kept. That is also why it is admin-only and leaves
     * no audit row behind. A dedicated `POST /api/stock/adjustments` that
     * records who counted what, and lets a cashier count too, is listed under
     * backend gaps in `apps/mobile/README.md`.
     */
    adjustStock(product: Product, countedStock: number): Promise<Product> {
      return updateFresh(product, { stock: countedStock })
    },

    listCategories(): Promise<Category[]> {
      return client.get<Category[]>("/categories")
    },
  }
}

export type ProductsApi = ReturnType<typeof createProductsApi>
