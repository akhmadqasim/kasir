import { useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import { id } from "@/i18n/id"
import type {
  PaginatedProducts,
  Product,
  CreateProductInput,
  UpdateProductInput,
  SearchProductsParams,
} from "../types"

export function useSearchProducts(params: SearchProductsParams) {
  return useTauriQuery<PaginatedProducts>(
    "search_products",
    { params },
    { placeholderData: keepPreviousData }
  )
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useTauriMutation<Product, { input: CreateProductInput; callerId: number }>("create_product", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search_products"] })
      toast.success(id.products.createSuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useTauriMutation<Product, { input: UpdateProductInput; callerId: number }>("update_product", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search_products"] })
      toast.success(id.products.updateSuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()

  return useTauriMutation<null, { id: number; callerId: number }>("delete_product", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search_products"] })
      toast.success(id.products.deleteSuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}
