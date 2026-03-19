import { ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useCartStore } from "../hooks/use-cart-store"
import { CartItemRow } from "./cart-item-row"
import { formatRupiah } from "../utils"

interface CartPanelProps {
  onPay: () => void
}

export function CartPanel({ onPay }: CartPanelProps) {
  const items = useCartStore((s) => s.items)
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const removeItem = useCartStore((s) => s.removeItem)
  const getTotal = useCartStore((s) => s.getTotal)

  const total = getTotal()
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <ShoppingCart className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Keranjang</h2>
        {items.length > 0 && (
          <Badge variant="secondary">{itemCount} item</Badge>
        )}
      </div>

      <Separator />

      {/* Cart Items */}
      {items.length === 0 ? (
        <Empty className="flex-1 border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShoppingCart />
            </EmptyMedia>
            <EmptyTitle>Keranjang Kosong</EmptyTitle>
            <EmptyDescription>
              Scan barcode atau cari produk untuk menambahkan ke keranjang
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="w-[100px] text-center">Qty</TableHead>
                <TableHead className="w-[90px] text-right">Subtotal</TableHead>
                <TableHead className="w-[36px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <CartItemRow
                  key={item.product_id}
                  item={item}
                  onUpdateQuantity={updateQuantity}
                  onRemove={removeItem}
                />
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      {/* Footer */}
      <Separator />
      <div className="bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xl font-semibold">Total</span>
          <span className="text-3xl font-bold tabular-nums">
            {formatRupiah(total)}
          </span>
        </div>
        <Button
          className="h-12 w-full text-lg font-semibold"
          size="lg"
          disabled={items.length === 0}
          onClick={onPay}
        >
          Bayar
        </Button>
      </div>
    </div>
  )
}
