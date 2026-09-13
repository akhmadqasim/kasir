import { useMemo, useState, useCallback } from "react"
import { Plus, Tags, Upload } from "lucide-react"
import { Button } from "@heroui/react"
import type { SortDescriptor } from "@heroui/react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { id } from "@/i18n/id"
import { useSearchProducts } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import { ProductSearch } from "./product-search"
import { ProductTable } from "./product-table"
import { ProductFormDialog } from "./product-form-dialog"
import { CategoryManager } from "./category-manager"
import { ImportDialog } from "./import-dialog"
import { defaultSort, toSearchSort } from "../sort"
import type { Product, ProductQuickFilter } from "../types"

export function ProductsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [quickFilter, setQuickFilter] = useState<ProductQuickFilter>("all")
  const [page, setPage] = useState(1)
  // `null` sampai pengguna memilih kolom: urutan bawaan mengikuti filter yang
  // aktif (lihat `defaultSort`). Ganti filter mengembalikannya ke `null`, supaya
  // "Stok Rendah" selalu mulai dari yang paling menipis.
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Di-memo karena `ProductTable` di-`memo` dan membandingkan prop-nya
  // dengan identitas; deskriptor baru tiap render sama saja tanpa memo.
  const effectiveSort = useMemo(
    () => sortDescriptor ?? defaultSort(quickFilter),
    [sortDescriptor, quickFilter],
  )

  const { data: productsData, isLoading } = useSearchProducts({
    query: searchQuery || undefined,
    category_id: categoryId,
    quick_filter: quickFilter === "all" ? undefined : quickFilter,
    page,
    per_page: 50,
    ...toSearchSort(effectiveSort),
  })

  const { data: categories } = useCategories()
  // `?? []` membuat array baru tiap render, dan `ProductTable` di-`memo`:
  // kunci identitasnya di sini supaya membuka dialog tidak menggambar ulang
  // lima puluh baris.
  const products = useMemo(() => productsData?.data ?? [], [productsData])
  const categoryList = useMemo(() => categories ?? [], [categories])

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
    setSortDescriptor(null)
    setPage(1)
  }, [])

  const handleSortChange = useCallback((descriptor: SortDescriptor) => {
    setSortDescriptor(descriptor)
    setPage(1)
  }, [])

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product)
    setFormOpen(true)
  }, [])

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

      <ProductTable
        products={products}
        categories={categoryList}
        isLoading={isLoading}
        page={productsData?.page ?? 1}
        totalPages={productsData?.total_pages ?? 1}
        onPageChange={setPage}
        onEdit={handleEdit}
        sortDescriptor={effectiveSort}
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
