import { useState, useCallback } from "react"
import { Plus, Tags, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { id } from "@/i18n/id"
import { useSearchProducts } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import { ProductSearch } from "./product-search"
import { ProductTable } from "./product-table"
import { ProductFormDialog } from "./product-form-dialog"
import { CategoryManager } from "./category-manager"
import { ImportDialog } from "./import-dialog"
import type { Product } from "../types"

export function ProductsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<string | undefined>(undefined)
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const { data: productsData, isLoading } = useSearchProducts({
    query: searchQuery || undefined,
    category_id: categoryId,
    page,
    per_page: 50,
    sort_by: sortBy,
    sort_order: sortOrder,
  })

  const { data: categories } = useCategories()

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query)
    setPage(1)
  }, [])

  const handleCategoryChange = useCallback((catId: number | null) => {
    setCategoryId(catId)
    setPage(1)
  }, [])

  const handleSortChange = useCallback((column: string) => {
    if (sortBy !== column) {
      setSortBy(column)
      setSortOrder("asc")
    } else if (sortOrder === "asc") {
      setSortOrder("desc")
    } else {
      setSortBy(undefined)
      setSortOrder("asc")
    }
  }, [sortBy, sortOrder])

  const handleEdit = (product: Product) => {
    setEditingProduct(product)
    setFormOpen(true)
  }

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingProduct(null)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{id.products.title}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button variant="outline" onClick={() => setCategoryManagerOpen(true)}>
            <Tags className="mr-2 h-4 w-4" />
            {id.products.manageCategories}
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {id.products.add}
          </Button>
        </div>
      </div>

      <ProductSearch
        onSearchChange={handleSearchChange}
        onCategoryChange={handleCategoryChange}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">{id.common.loading}</p>
        </div>
      ) : (
        <ProductTable
          products={productsData?.data ?? []}
          categories={categories ?? []}
          page={productsData?.page ?? 1}
          totalPages={productsData?.total_pages ?? 1}
          onPageChange={setPage}
          onEdit={handleEdit}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={handleSortChange}
        />
      )}

      <ProductFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        product={editingProduct}
      />

      <CategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  )
}
