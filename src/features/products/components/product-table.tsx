import { useState } from "react"
import { Pencil, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Pin } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useDeleteProduct } from "../hooks/use-products"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { useQueryClient } from "@tanstack/react-query"
import type { Product, Category } from "../types"

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

function SortableHeader({
  label,
  column,
  sortBy,
  sortOrder,
  onSort,
  className,
}: {
  label: string
  column: string
  sortBy?: string
  sortOrder?: "asc" | "desc"
  onSort: (column: string) => void
  className?: string
}) {
  const isActive = sortBy === column
  return (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 gap-1"
        onClick={() => onSort(column)}
      >
        {label}
        {isActive ? (
          sortOrder === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </Button>
    </TableHead>
  )
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
  const user = useAuthStore((s) => s.user)
  const deleteProduct = useDeleteProduct()
  const queryClient = useQueryClient()

  // Fetch pinned product IDs
  const { data: shortcuts } = useTauriQuery<Array<{ id: number; product_id: number; is_pinned: boolean }>>(
    "get_popular_products",
    { limit: 50 }
  )
  const pinnedIds = new Set(
    (shortcuts ?? []).filter((s) => s.is_pinned).map((s) => s.id)
  )

  const handleTogglePin = async (productId: number) => {
    try {
      const pinned = await invoke<boolean>("toggle_product_pin", { productId })
      toast.success(pinned ? "Produk di-pin ke shortcut" : "Pin shortcut dihapus")
      queryClient.invalidateQueries({ queryKey: ["get_popular_products"] })
    } catch {
      toast.error("Gagal mengubah pin")
    }
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]))

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteProduct.mutate({ id: deleteTarget.id, callerId: user!.id }, {
      onSettled: () => setDeleteTarget(null),
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader label={id.products.name} column="name" sortBy={sortBy} sortOrder={sortOrder} onSort={onSortChange} />
              <TableHead>{id.products.barcode}</TableHead>
              <TableHead>{id.products.category}</TableHead>
              <SortableHeader label={id.products.sellPrice} column="sell_price" sortBy={sortBy} sortOrder={sortOrder} onSort={onSortChange} className="text-right" />
              <SortableHeader label={id.products.stock} column="stock" sortBy={sortBy} sortOrder={sortOrder} onSort={onSortChange} className="text-right" />
              <TableHead className="text-right">{id.products.action}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {id.products.noProducts}
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.barcode || "—"}
                  </TableCell>
                  <TableCell>
                    {product.category_id ? categoryMap.get(product.category_id) || "—" : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {rupiahFormatter.format(product.sell_price)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span>{product.stock}</span>
                      {product.stock <= product.min_stock && (
                        <Badge variant="destructive">{id.products.lowStock}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTogglePin(product.id)}
                        title={pinnedIds.has(product.id) ? "Hapus pin shortcut" : "Pin ke shortcut kasir"}
                      >
                        <Pin className={`h-4 w-4 ${pinnedIds.has(product.id) ? "fill-current text-primary" : "text-muted-foreground"}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(product)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(product)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">
            {id.products.page} {page} {id.products.of} {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {id.products.prev}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {id.products.next}
          </Button>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{id.common.confirm}</AlertDialogTitle>
            <AlertDialogDescription>
              {id.products.deleteConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{id.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {id.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
