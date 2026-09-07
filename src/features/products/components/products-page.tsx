import { useMemo, useState, useCallback } from "react"
import { Plus, Tags, Upload } from "lucide-react"
import { Button, Card } from "@heroui/react"

import { id } from "@/i18n/id"
import { useSearchProducts } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import { ProductSearch } from "./product-search"
import { ProductTable } from "./product-table"
import { ProductFormDialog } from "./product-form-dialog"
import { CategoryManager } from "./category-manager"
import { ImportDialog } from "./import-dialog"
import type { Product, ProductQuickFilter } from "../types"

export function ProductsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [quickFilter, setQuickFilter] = useState<ProductQuickFilter>("all")
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<string | undefined>(undefined)
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const effectiveSortBy =
    !sortBy && (quickFilter === "low_stock" || quickFilter === "negative_stock")
      ? "stock"
      : (sortBy ?? "created_at")
  const effectiveSortOrder =
    !sortBy && (quickFilter === "low_stock" || quickFilter === "negative_stock")
      ? "asc"
      : sortBy
        ? sortOrder
        : "desc"

  const { data: productsData, isLoading } = useSearchProducts({
    query: searchQuery || undefined,
    category_id: categoryId,
    quick_filter: quickFilter === "all" ? undefined : quickFilter,
    page,
    per_page: 50,
    sort_by: effectiveSortBy,
    sort_order: effectiveSortOrder,
  })

  const { data: categories } = useCategories()
  // `?? []` membuat array baru tiap render, jadi memo di bawahnya tidak pernah
  // menyimpan apa pun. Kunci identitasnya di sini.
  const products = useMemo(() => productsData?.data ?? [], [productsData])

  const reviewSummary = useMemo(() => {
    const noBarcode = products.filter((product) => !product.barcode?.trim()).length
    const negativeStock = products.filter((product) => product.stock < 0).length
    const lowStock = products.filter(
      (product) => product.stock >= 0 && product.stock <= product.min_stock,
    ).length

    return { noBarcode, negativeStock, lowStock }
  }, [products])

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query)
    setPage(1)
  }, [])

  const handleCategoryChange = useCallback((catId: number | null) => {
    setCategoryId(catId)
    setPage(1)
  }, [])

  const handleQuickFilterChange = useCallback((filter: ProductQuickFilter) => {
    setQuickFilter(filter)
    setPage(1)
  }, [])

  const handleSortChange = useCallback(
    (column: string) => {
      if (sortBy !== column) {
        setSortBy(column)
        setSortOrder("asc")
      } else if (sortOrder === "asc") {
        setSortOrder("desc")
      } else {
        setSortBy(undefined)
        setSortOrder("asc")
      }
    },
    [sortBy, sortOrder],
  )

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
          <Button variant="secondary" onPress={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button variant="secondary" onPress={() => setCategoryManagerOpen(true)}>
            <Tags className="mr-2 h-4 w-4" />
            {id.products.manageCategories}
          </Button>
          <Button onPress={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {id.products.add}
          </Button>
        </div>
      </div>

      <ProductSearch
        onSearchChange={handleSearchChange}
        onCategoryChange={handleCategoryChange}
        quickFilter={quickFilter}
        onQuickFilterChange={handleQuickFilterChange}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <Card.Content className="p-4">
            <div className="text-2xl font-bold tabular-nums">{reviewSummary.lowStock}</div>
            <p className="text-sm text-muted">Stok rendah pada hasil saat ini</p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content className="p-4">
            <div className="text-2xl font-bold tabular-nums">{reviewSummary.negativeStock}</div>
            <p className="text-sm text-muted">Stok minus pada hasil saat ini</p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content className="p-4">
            <div className="text-2xl font-bold tabular-nums">{reviewSummary.noBarcode}</div>
            <p className="text-sm text-muted">Tanpa barcode pada hasil saat ini</p>
          </Card.Content>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted">{id.common.loading}</p>
        </div>
      ) : (
        <ProductTable
          products={products}
          categories={categories ?? []}
          page={productsData?.page ?? 1}
          totalPages={productsData?.total_pages ?? 1}
          onPageChange={setPage}
          onEdit={handleEdit}
          sortBy={effectiveSortBy}
          sortOrder={effectiveSortOrder}
          onSortChange={handleSortChange}
        />
      )}

      <ProductFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        product={editingProduct}
        onCreateSuccess={() => setPage(1)}
      />

      <CategoryManager open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen} />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
