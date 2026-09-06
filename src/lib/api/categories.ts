import type { Category } from "@/features/products/types"
import { apiDelete, apiGet, apiPost, apiPut } from "./client"

export interface CreateCategoryInput {
  name: string
  description?: string
}

export interface UpdateCategoryInput extends CreateCategoryInput {
  id: number
}

export function listCategories(): Promise<Category[]> {
  return apiGet<Category[]>("/categories")
}

export function createCategory(input: CreateCategoryInput): Promise<Category> {
  return apiPost<Category>("/categories", input)
}

/** As with products, the id is in both the path and the body; the path wins. */
export function updateCategory(input: UpdateCategoryInput): Promise<Category> {
  return apiPut<Category>(`/categories/${input.id}`, input)
}

export function deleteCategory(categoryId: number): Promise<void> {
  return apiDelete<void>(`/categories/${categoryId}`)
}
