import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
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
import { useDeleteProduct } from "../hooks/use-products"
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
}

export function ProductTable({
  products,
  categories,
  page,
  totalPages,
  onPageChange,
  onEdit,
}: ProductTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const deleteProduct = useDeleteProduct()

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]))

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteProduct.mutate({ id: deleteTarget.id }, {
      onSettled: () => setDeleteTarget(null),
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{id.products.name}</TableHead>
              <TableHead>{id.products.barcode}</TableHead>
              <TableHead>{id.products.category}</TableHead>
              <TableHead className="text-right">{id.products.sellPrice}</TableHead>
              <TableHead className="text-right">{id.products.stock}</TableHead>
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
