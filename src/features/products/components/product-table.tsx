import { memo, useCallback, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertDialog, Button, Skeleton, Table } from "@heroui/react"
import type { SortDescriptor } from "@heroui/react"

import { toast } from "@/lib/toast"
import { NoData } from "@/components/no-data"
import { TablePagination } from "@/components/table-pagination"
import { id } from "@/i18n/id"
import { useDeleteProduct } from "../hooks/use-products"
import { useApiQuery } from "@/hooks/use-api"
import { getPopularProducts, toggleProductPin } from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import { ProductRow } from "./product-row"
import type { ProductSortColumn } from "../sort"
import type { Product, Category, ShortcutProduct } from "../types"

/** How many shortcut rows to read when deciding which products show a filled pin. */
const SHORTCUT_LIMIT = 50

const COLUMN_COUNT = 6

/** Kolom yang bisa diurutkan, dengan `id` yang dikirim apa adanya sebagai `sort_by`. */
const SORTABLE_COLUMNS: ReadonlyArray<{
  id: ProductSortColumn
  label: string
  isRowHeader?: boolean
  className?: string
}> = [
  { id: "name", label: id.products.name, isRowHeader: true },
  { id: "barcode", label: id.products.barcode },
  { id: "category", label: id.products.category },
  { id: "sell_price", label: id.products.sellPrice, className: "text-right" },
  { id: "stock", label: id.products.stock, className: "text-right" },
]

/*
 * Kepala tabel mengikuti contoh "Sorting" di dokumentasi Table HeroUI:
 * `allowsSorting` di kolom, `sortDirection` dari render prop diteruskan ke
 * `Table.SortableColumnHeader` yang menggambar panahnya.
 *
 * Dibuat sekali di tingkat modul, bukan di dalam render: React Aria membangun
 * ulang koleksinya begitu ada elemen kolom yang berubah, dan pembangunan ulang
 * itu berarti satu gambar ulang penuh tambahan untuk kelima puluh baris.
 * Elemen yang identitasnya tetap tidak memicunya.
 */
const HEADER = (
  <Table.Header>
    {SORTABLE_COLUMNS.map((column) => (
      <Table.Column
        key={column.id}
        allowsSorting
        className={column.className}
        id={column.id}
        isRowHeader={column.isRowHeader}
      >
        {({ sortDirection }) => (
          <Table.SortableColumnHeader sortDirection={sortDirection}>
            {column.label}
          </Table.SortableColumnHeader>
        )}
      </Table.Column>
    ))}
    <Table.Column className="text-right" id="actions">
      {id.products.action}
    </Table.Column>
  </Table.Header>
)

const renderEmptyState = () => <NoData title={id.products.noProducts} />

interface ProductTableProps {
  products: Product[]
  categories: Category[]
  /** Baris `Skeleton` menggantikan isi selama pencarian pertama berjalan. */
  isLoading?: boolean
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onEdit: (product: Product) => void
  sortDescriptor: SortDescriptor
  onSortChange: (descriptor: SortDescriptor) => void
}

/**
 * Di-`memo`, dengan setiap prop dijaga stabil oleh halaman: membuka atau
 * menutup dialog ubah mengubah state halaman, dan tanpa ini kelima puluh
 * baris ikut digambar ulang tiap kali — lihat catatan di `ProductRow`.
 */
export const ProductTable = memo(function ProductTable({
  products,
  categories,
  isLoading = false,
  page,
  totalPages,
  onPageChange,
  onEdit,
  sortDescriptor,
  onSortChange,
}: ProductTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const deleteProduct = useDeleteProduct()
  const queryClient = useQueryClient()

  // Which products are pinned to the cashier's shortcut grid. The server
  // flattens the product into the row, so `id` here is the product's own id.
  const { data: shortcuts } = useApiQuery<ShortcutProduct[]>(
    queryKeys.products.popular(SHORTCUT_LIMIT),
    () => getPopularProducts(SHORTCUT_LIMIT),
  )
  const pinnedIds = useMemo(
    () => new Set((shortcuts ?? []).filter((s) => s.is_pinned).map((s) => s.id)),
    [shortcuts],
  )

  const handleTogglePin = useCallback(
    async (productId: number) => {
      try {
        const pinned = await toggleProductPin(productId)
        toast.success(pinned ? "Produk di-pin ke shortcut" : "Pin shortcut dihapus")
        queryClient.invalidateQueries({ queryKey: queryKeys.products.popularAll })
      } catch {
        toast.error("Gagal mengubah pin")
      }
    },
    [queryClient],
  )

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteProduct.mutate(deleteTarget.id, {
      onSettled: () => setDeleteTarget(null),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Varian bawaan (`primary`), bukan `secondary` seperti tabel lain: isi
          tabelnya kartu putih bersudut membulat di atas kanvas, seperti tabel
          di template HeroUI Pro — permintaan pemilik toko untuk layar ini. */}
      <Table>
        <Table.ScrollContainer>
          <Table.Content
            aria-label={id.products.title}
            sortDescriptor={sortDescriptor}
            onSortChange={onSortChange}
          >
            {HEADER}
            <Table.Body renderEmptyState={renderEmptyState}>
              {isLoading
                ? Array.from({ length: 5 }).map((_, rowIndex) => (
                    <Table.Row key={`skeleton-${rowIndex}`} id={`skeleton-${rowIndex}`}>
                      {Array.from({ length: COLUMN_COUNT }).map((_, cellIndex) => (
                        <Table.Cell key={cellIndex}>
                          <Skeleton className="h-5 w-full" />
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))
                : products.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      categoryName={
                        product.category_id ? (categoryMap.get(product.category_id) ?? "—") : null
                      }
                      isPinned={pinnedIds.has(product.id)}
                      onEdit={onEdit}
                      onDelete={setDeleteTarget}
                      onTogglePin={handleTogglePin}
                    />
                  ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <TablePagination page={page} totalPages={totalPages} onPageChange={onPageChange} />

      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.common.confirm}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.common.confirm}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{id.products.deleteConfirm}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <Button variant="danger" onPress={handleDelete}>
                {id.common.delete}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
})
