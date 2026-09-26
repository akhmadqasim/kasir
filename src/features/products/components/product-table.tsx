import { memo, useCallback, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PackageSearch, Plus } from "lucide-react"
import { AlertDialog, Button, Table } from "@heroui/react"
import type { SortDescriptor } from "@heroui/react"

import { toast } from "@/lib/toast"
import { InfoPanel } from "@/components/info-panel"
import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { TablePagination } from "@/components/table-pagination"
import { id } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
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
  /** Kolom angka: kepala dan isinya rata kanan. */
  isNumeric?: boolean
}> = [
  { id: "name", label: id.products.name, isRowHeader: true },
  { id: "barcode", label: id.products.barcode },
  { id: "category", label: id.products.category },
  { id: "sell_price", label: id.products.sellPrice, isNumeric: true },
  { id: "stock", label: id.products.stock, isNumeric: true },
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
        className={column.isNumeric ? "text-right" : undefined}
        id={column.id}
        isRowHeader={column.isRowHeader}
      >
        {/* `SortableColumnHeader` adalah flex `justify-between`, jadi
            `text-right` di kolomnya tidak menggeser labelnya: kepala "Harga
            Jual" dan "Stok" dulu rata kiri di atas angka yang rata kanan.
            Dibalik, labelnya menempel ke tepi kanan dan panahnya di kirinya. */}
        {({ sortDirection }) => (
          <Table.SortableColumnHeader
            className={column.isNumeric ? "flex-row-reverse justify-start gap-1" : undefined}
            sortDirection={sortDirection}
          >
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

interface ProductTableProps {
  products: Product[]
  categories: Category[]
  /** Baris `Skeleton` menggantikan isi selama pencarian pertama berjalan. */
  isLoading?: boolean
  /**
   * `true` selama isi yang tampil masih milik filter/halaman sebelumnya
   * (`keepPreviousData`): tabelnya diredupkan supaya kasir tidak membaca
   * hasil lama sebagai jawaban kueri barunya.
   */
  isRefreshing?: boolean
  /** Ada pencarian atau filter aktif — keadaan kosongnya "tidak cocok", bukan "belum ada". */
  hasFilters?: boolean
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onAdd: () => void
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
  isRefreshing = false,
  hasFilters = false,
  page,
  totalPages,
  onPageChange,
  onAdd,
  onEdit,
  sortDescriptor,
  onSortChange,
}: ProductTableProps) {
  // Target dan keadaan buka dipisah: target tetap terisi selama animasi tutup,
  // jadi isi dialog tidak mengosong sesaat sebelum hilang.
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pendingPins, setPendingPins] = useState<ReadonlySet<number>>(() => new Set())
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
      setPendingPins((prev) => new Set(prev).add(productId))
      try {
        const pinned = await toggleProductPin(productId)
        toast.success(pinned ? id.products.pinned : id.products.unpinned)
        await queryClient.invalidateQueries({ queryKey: queryKeys.products.popularAll })
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : id.products.pinFailed)
      } finally {
        setPendingPins((prev) => {
          const next = new Set(prev)
          next.delete(productId)
          return next
        })
      }
    },
    [queryClient],
  )

  const handleRequestDelete = useCallback((product: Product) => {
    setDeleteTarget(product)
    setDeleteOpen(true)
  }, [])

  const renderEmptyState = useCallback(
    () =>
      hasFilters ? (
        <NoData icon={<PackageSearch />} title={id.noMatch.products}>
          Coba kata kunci lain, atau ganti filter kategori dan stok.
        </NoData>
      ) : (
        <NoData
          action={
            <Button size="sm" variant="secondary" onPress={onAdd}>
              <Plus />
              {id.products.add}
            </Button>
          }
          icon={<PackageSearch />}
          title={id.products.noProducts}
        >
          Tambahkan satu per satu, atau import dari file Excel.
        </NoData>
      ),
    [hasFilters, onAdd],
  )

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const handleDelete = () => {
    if (!deleteTarget || deleteProduct.isPending) return
    deleteProduct.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteOpen(false),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Varian bawaan (`primary`), bukan `secondary` seperti tabel lain: isi
          tabelnya kartu putih bersudut membulat di atas kanvas, seperti tabel
          di template HeroUI Pro — permintaan pemilik toko untuk layar ini. */}
      <Table
        aria-busy={isLoading || isRefreshing}
        className={cn("transition-opacity", isRefreshing && "opacity-60")}
      >
        <Table.ScrollContainer>
          <Table.Content
            aria-label={id.products.title}
            sortDescriptor={sortDescriptor}
            onSortChange={onSortChange}
          >
            {HEADER}
            <Table.Body renderEmptyState={renderEmptyState}>
              {isLoading ? (
                <TableSkeletonRows columns={COLUMN_COUNT} rows={5} />
              ) : (
                products.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    categoryName={
                      product.category_id ? (categoryMap.get(product.category_id) ?? "—") : null
                    }
                    isPinned={pinnedIds.has(product.id)}
                    isPinPending={pendingPins.has(product.id)}
                    onEdit={onEdit}
                    onDelete={handleRequestDelete}
                    onTogglePin={handleTogglePin}
                  />
                ))
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <TablePagination page={page} totalPages={totalPages} onPageChange={onPageChange} />

      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Hapus Produk</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{id.products.deleteConfirm}</p>
              {deleteTarget && (
                <InfoPanel>
                  <SummaryList
                    layout="grid"
                    items={[
                      { label: id.products.name, value: deleteTarget.name },
                      {
                        label: id.products.barcode,
                        value: deleteTarget.barcode?.trim() || "—",
                        tone: "mono",
                      },
                      {
                        label: id.products.sellPrice,
                        value: formatRupiah(deleteTarget.sell_price),
                      },
                      {
                        label: id.products.stock,
                        value: `${formatNumber(deleteTarget.stock)} ${deleteTarget.unit}`,
                      },
                    ]}
                  />
                </InfoPanel>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={deleteProduct.isPending} slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <PendingButton
                isPending={deleteProduct.isPending}
                variant="danger"
                onPress={handleDelete}
              >
                {id.common.delete}
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
})
