import { useMemo, useState, useCallback } from "react"
import { Plus, Tags, Upload } from "lucide-react"
import { Button } from "@heroui/react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { StatCard } from "@/components/stat-card"
import { id } from "@/i18n/id"
import { formatNumber } from "@/lib/format"
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
    // DESIGN.md §5.1: judul dari navbar, aksi lewat `NavbarActions`, satu `primary`.
    <div className="flex flex-col gap-6">
      <NavbarActions>
        <Button size="sm" variant="tertiary" onPress={() => setImportOpen(true)}>
          <Upload />
          Import
        </Button>
        <Button size="sm" variant="tertiary" onPress={() => setCategoryManagerOpen(true)}>
          <Tags />
          {id.products.manageCategories}
        </Button>
        <Button size="sm" onPress={() => setFormOpen(true)}>
          <Plus />
          {id.products.add}
        </Button>
      </NavbarActions>

      <ProductSearch
        onSearchChange={handleSearchChange}
        onCategoryChange={handleCategoryChange}
        quickFilter={quickFilter}
        onQuickFilterChange={handleQuickFilterChange}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Stok rendah pada hasil saat ini"
          value={formatNumber(reviewSummary.lowStock)}
        />
        <StatCard
          label="Stok minus pada hasil saat ini"
          value={formatNumber(reviewSummary.negativeStock)}
        />
        <StatCard
          label="Tanpa barcode pada hasil saat ini"
          value={formatNumber(reviewSummary.noBarcode)}
        />
      </div>

      <ProductTable
        products={products}
        categories={categories ?? []}
        isLoading={isLoading}
        page={productsData?.page ?? 1}
        totalPages={productsData?.total_pages ?? 1}
        onPageChange={setPage}
        onEdit={handleEdit}
        sortBy={effectiveSortBy}
        sortOrder={effectiveSortOrder}
        onSortChange={handleSortChange}
      />

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
