import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/toast"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "@/lib/api/categories"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import type { Category } from "../types"

export function useCategories() {
  return useApiQuery<Category[]>(queryKeys.categories.list, listCategories)
}

export function useCreateCategory() {
  const queryClient = useQueryClient()

  return useApiMutation<Category, CreateCategoryInput>(createCategory, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
      toast.success(id.products.categorySuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()

  return useApiMutation<Category, UpdateCategoryInput>(updateCategory, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
      toast.success(id.products.categorySuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

export function useDeleteCategory() {
  const queryClient = useQueryClient()

  return useApiMutation<void, number>(deleteCategory, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
      toast.success(id.products.categorySuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.products.categoryHasProducts)
    },
  })
}
