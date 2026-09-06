import { useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { toast } from "@/lib/toast"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import {
  createProduct,
  deleteProduct,
  searchProducts,
  updateProduct,
} from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import type {
  PaginatedProducts,
  Product,
  CreateProductInput,
  UpdateProductInput,
  SearchProductsParams,
} from "../types"

export function useSearchProducts(params: SearchProductsParams) {
  return useApiQuery<PaginatedProducts>(
    queryKeys.products.search(params),
    () => searchProducts(params),
    { placeholderData: keepPreviousData }
  )
}

/**
 * Writing a product moves both lists a screen can be showing: the catalogue and
 * the cashier's shortcut grid, which orders itself by what sells. Invalidating
 * `products.all` covers both, which is the right blast radius here — unlike the
 * per-scan selection tracking, which touches only the shortcuts.
 */
function invalidateProducts(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useApiMutation<Product, CreateProductInput>(createProduct, {
    onSuccess: () => {
      invalidateProducts(queryClient)
      toast.success(id.products.createSuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useApiMutation<Product, UpdateProductInput>(updateProduct, {
    onSuccess: () => {
      invalidateProducts(queryClient)
      toast.success(id.products.updateSuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()

  return useApiMutation<void, number>(deleteProduct, {
    onSuccess: () => {
      invalidateProducts(queryClient)
      toast.success(id.products.deleteSuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}
