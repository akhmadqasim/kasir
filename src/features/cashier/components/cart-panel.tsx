import { ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
      <div className="flex items-center gap-2 p-4 pb-2">
        <ShoppingCart className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Keranjang</h2>
        {items.length > 0 && (
          <Badge variant="secondary">
            {itemCount} item
          </Badge>
        )}
      </div>

      <Separator />

      {/* Cart Items */}
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <ShoppingCart className="mx-auto mb-2 h-12 w-12 opacity-30" />
            <p>Keranjang kosong</p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 p-4">
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <CartItemRow
                key={item.product_id}
                item={item}
                onUpdateQuantity={updateQuantity}
                onRemove={removeItem}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Footer */}
      <div className="border-t bg-background p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-lg font-medium">Total</span>
          <span className="text-2xl font-bold tabular-nums">
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
