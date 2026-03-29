import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import { id } from "@/i18n/id"
import type { Category } from "../types"

export function useCategories() {
  return useTauriQuery<Category[]>("list_categories")
}

export function useCreateCategory() {
  const queryClient = useQueryClient()

  return useTauriMutation<Category, { name: string; description?: string; callerId: number }>(
    "create_category",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["list_categories"] })
        toast.success(id.products.categorySuccess)
      },
      onError: (error) => {
        toast.error(error.message || id.common.error)
      },
    }
  )
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()

  return useTauriMutation<Category, { id: number; name: string; description?: string; callerId: number }>(
    "update_category",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["list_categories"] })
        toast.success(id.products.categorySuccess)
      },
      onError: (error) => {
        toast.error(error.message || id.common.error)
      },
    }
  )
}

export function useDeleteCategory() {
  const queryClient = useQueryClient()

  return useTauriMutation<null, { id: number; callerId: number }>("delete_category", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list_categories"] })
      toast.success(id.products.categorySuccess)
    },
    onError: (error) => {
      toast.error(error.message || id.products.categoryHasProducts)
    },
  })
}
