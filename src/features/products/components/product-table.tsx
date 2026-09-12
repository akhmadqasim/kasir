import { useState } from "react"
import { Pencil, Trash2, Pin } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertDialog, Button, Table, Tooltip } from "@heroui/react"
import type { SortDescriptor } from "@heroui/react"

import { toast } from "@/lib/toast"
import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { id } from "@/i18n/id"
import { useDeleteProduct } from "../hooks/use-products"
import { useApiQuery } from "@/hooks/use-api"
import { getPopularProducts, toggleProductPin } from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import type { Product, Category, ShortcutProduct } from "../types"

/** How many shortcut rows to read when deciding which products show a filled pin. */
const SHORTCUT_LIMIT = 50

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

interface ProductTableProps {
  products: Product[]
  categories: Category[]
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onEdit: (product: Product) => void
  sortBy?: string
  sortOrder?: "asc" | "desc"
  onSortChange: (column: string) => void
}

export function ProductTable({
  products,
  categories,
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
  const pinnedIds = new Set((shortcuts ?? []).filter((s) => s.is_pinned).map((s) => s.id))

  const handleTogglePin = async (productId: number) => {
    try {
      const pinned = await toggleProductPin(productId)
      toast.success(pinned ? "Produk di-pin ke shortcut" : "Pin shortcut dihapus")
      queryClient.invalidateQueries({ queryKey: queryKeys.products.popularAll })
    } catch {
      toast.error("Gagal mengubah pin")
    }
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]))

  const getStockBadge = (product: Product) => {
    if (product.stock < 0) {
      return (
        <StatusBadge status="error" size="sm">
          Stok Minus
        </StatusBadge>
      )
    }
    if (product.stock === 0) {
      return (
        <StatusBadge status="error" size="sm">
          Stok Habis
        </StatusBadge>
      )
    }
    if (product.stock <= product.min_stock) {
      return (
        <StatusBadge status="warning" size="sm">
          {id.products.lowStock}
        </StatusBadge>
      )
    }
    return null
  }

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
  const sortDescriptor: SortDescriptor = {
    column: sortBy ?? "",
    direction: sortOrder === "desc" ? "descending" : "ascending",
  }

  const renderEmptyState = () => <NoData title={id.products.noProducts} />

  return (
    <div className="space-y-4">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content
            aria-label={id.products.title}
            sortDescriptor={sortDescriptor}
            onSortChange={(descriptor) => onSortChange(String(descriptor.column))}
          >
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
            <Table.Body renderEmptyState={renderEmptyState}>
              {products.map((product) => (
                <Table.Row key={product.id} id={product.id} textValue={product.name}>
                  <Table.Cell className="font-medium">
                    <div className="space-y-1">
                      <div>{product.name}</div>
                      <div className="flex flex-wrap gap-1">
                        {!product.barcode?.trim() && (
                          <StatusBadge status="neutral" size="sm">
                            Tanpa Barcode
                          </StatusBadge>
                        )}
                        {!product.category_id && (
                          <StatusBadge status="neutral" size="sm">
                            Tanpa Kategori
                          </StatusBadge>
                        )}
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-muted">{product.barcode?.trim() || "—"}</Table.Cell>
                  <Table.Cell>
                    <span className={cn(!product.category_id && "text-muted")}>
                      {product.category_id
                        ? categoryMap.get(product.category_id) || "—"
                        : "Tanpa kategori"}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {rupiahFormatter.format(product.sell_price)}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={cn(
                          "tabular-nums",
                          product.stock < 0 && "font-semibold text-danger",
                        )}
                      >
                        {product.stock}
                      </span>
                      {getStockBadge(product)}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <PinActionButton
                        isPinned={pinnedIds.has(product.id)}
                        onPress={() => handleTogglePin(product.id)}
                      />
                      <Button
                        aria-label={`${id.common.edit} ${product.name}`}
                        isIconOnly
                        size="sm"
                        variant="secondary"
                        onPress={() => onEdit(product)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        aria-label={`${id.common.delete} ${product.name}`}
                        isIconOnly
                        size="sm"
                        variant="danger"
                        onPress={() => setDeleteTarget(product)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
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
}

/**
 * Pin produk ke shortcut kasir.
 *
 * Ikonnya sendiri tidak menjelaskan apa-apa, jadi alasannya dulu dititipkan ke
 * atribut `title` — hanya terbaca kalau kursor berhenti di atasnya. Tombolnya
 * aktif, jadi `Tooltip` boleh membungkus `Button` langsung tanpa
 * `Tooltip.Trigger`: pembungkus itu menambah satu titik Tab yang tidak perlu.
 */
function PinActionButton({ isPinned, onPress }: { isPinned: boolean; onPress: () => void }) {
  const label = isPinned ? "Hapus pin shortcut" : "Pin ke shortcut kasir"

  return (
    <Tooltip>
      <Button aria-label={label} isIconOnly size="sm" variant="secondary" onPress={onPress}>
        <Pin className={isPinned ? "fill-current text-accent" : "text-muted"} />
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}
