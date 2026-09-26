import type { SearchProductsParams } from "../types/products"
import type { ListWriteoffsParams } from "../types/stock"

/**
 * Every React Query key the shared resources use, in one table.
 *
 * Copied (and trimmed to the resources the mobile app needs) from the
 * desktop's `src/lib/api/query-keys.ts`. A query and the invalidation that must
 * hit it come from the same factory, so a key that no longer exists is a
 * compile error rather than a stale screen.
 *
 * Keys are hierarchical, widest first, and React Query matches invalidations
 * by prefix: `products.all` hits every product query, `products.searchAll`
 * only the searches.
 */
export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: ["auth", "me"] as const,
  },

  products: {
    all: ["products"] as const,
    searchAll: ["products", "search"] as const,
    search: (params: SearchProductsParams) => ["products", "search", params] as const,
    detail: (productId: number) => ["products", "detail", productId] as const,
  },

  categories: {
    all: ["categories"] as const,
    list: ["categories", "list"] as const,
  },

  store: {
    all: ["store"] as const,
    /**
     * Per server: the login screen of a phone that just switched desktops must
     * not show the previous shop's name while the new one loads.
     */
    public: (origin: string) => ["store", "public", origin] as const,
  },

  stock: {
    all: ["stock"] as const,
    writeoffsAll: ["stock", "writeoffs"] as const,
    writeoffs: (params: ListWriteoffsParams) => ["stock", "writeoffs", params] as const,
  },
} as const
