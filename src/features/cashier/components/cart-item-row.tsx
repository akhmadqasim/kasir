import { Minus, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CartItem } from "../types"
import { formatRupiah } from "../utils"

interface CartItemRowProps {
  item: CartItem
  onUpdateQuantity: (productId: number, qty: number) => void
  onRemove: (productId: number) => void
}

export function CartItemRow({
  item,
  onUpdateQuantity,
  onRemove,
}: CartItemRowProps) {
  const subtotal = item.product_price * item.quantity

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.product_name}</p>
        <p className="text-sm text-muted-foreground">
          {formatRupiah(item.product_price)} / {item.unit}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdateQuantity(item.product_id, item.quantity - 1)}
          disabled={item.quantity <= 1}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-10 text-center font-medium tabular-nums">
          {item.quantity}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdateQuantity(item.product_id, item.quantity + 1)}
          disabled={item.quantity >= item.stock}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="w-28 text-right">
        <p className="font-semibold tabular-nums">{formatRupiah(subtotal)}</p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={() => onRemove(item.product_id)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
