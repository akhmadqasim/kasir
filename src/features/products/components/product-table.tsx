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
import type { Product, Category, ShortcutProduct } from "../types"

/** How many shortcut rows to read when deciding which products show a filled pin. */
const SHORTCUT_LIMIT = 50

const COLUMN_COUNT = 6

/*
 * Kepala tabel dibuat sekali di tingkat modul, bukan di dalam render: React
 * Aria membangun ulang koleksinya begitu ada elemen kolom yang berubah, dan
 * pembangunan ulang itu berarti satu gambar ulang penuh tambahan untuk kelima
 * puluh baris. Elemen yang identitasnya tetap tidak memicunya.
 */
const HEADER = (
  <Table.Header>
    <Table.Column allowsSorting isRowHeader id="name">
      {({ sortDirection }) => (
        <Table.SortableColumnHeader sortDirection={sortDirection}>
          {id.products.name}
        </Table.SortableColumnHeader>
      )}
    </Table.Column>
    <Table.Column id="barcode">{id.products.barcode}</Table.Column>
    <Table.Column id="category">{id.products.category}</Table.Column>
    <Table.Column allowsSorting className="text-right" id="sell_price">
      {({ sortDirection }) => (
        <Table.SortableColumnHeader sortDirection={sortDirection}>
          {id.products.sellPrice}
        </Table.SortableColumnHeader>
      )}
    </Table.Column>
    <Table.Column allowsSorting className="text-right" id="stock">
      {({ sortDirection }) => (
        <Table.SortableColumnHeader sortDirection={sortDirection}>
          {id.products.stock}
        </Table.SortableColumnHeader>
      )}
    </Table.Column>
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
  sortBy?: string
  sortOrder?: "asc" | "desc"
  onSortChange: (column: string) => void
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
  sortBy,
  sortOrder,
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

  // React Aria hanya mengenal dua arah, sedangkan layar ini bersiklus tiga
  // langkah: naik, turun, lalu kembali tanpa urutan. Arah yang dihitung React
  // Aria dibuang dan induknya yang memutuskan langkah berikutnya, persis seperti
  // sebelum pindah ke `Table`.
  const sortDescriptor = useMemo<SortDescriptor>(
    () => ({
      column: sortBy ?? "",
      direction: sortOrder === "desc" ? "descending" : "ascending",
    }),
    [sortBy, sortOrder],
  )
  const handleSortChange = useCallback(
    (descriptor: SortDescriptor) => onSortChange(String(descriptor.column)),
    [onSortChange],
  )

  return (
    <div className="flex flex-col gap-4">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content
            aria-label={id.products.title}
            sortDescriptor={sortDescriptor}
            onSortChange={handleSortChange}
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
