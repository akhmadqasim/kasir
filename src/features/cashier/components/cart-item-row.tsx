import { useState } from "react"
import { Minus, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
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
  const [editingQty, setEditingQty] = useState(false)
  const [qtyInput, setQtyInput] = useState("")
  const subtotal = item.product_price * item.quantity

  const handleQtyBlur = () => {
    const parsed = parseInt(qtyInput, 10)
    if (!isNaN(parsed) && parsed >= 1) {
      onUpdateQuantity(item.product_id, parsed)
    }
    setEditingQty(false)
  }

  const handleQtyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleQtyBlur()
    } else if (e.key === "Escape") {
      setEditingQty(false)
    }
  }

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{item.product_name}</p>
          <p className="text-xs text-muted-foreground">
            {formatRupiah(item.product_price)} / {item.unit}
          </p>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => onUpdateQuantity(item.product_id, item.quantity - 1)}
            disabled={item.quantity <= 1}
          >
            <Minus className="h-3 w-3" />
          </Button>
          {editingQty ? (
            <Input
              type="number"
              min="1"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onBlur={handleQtyBlur}
              onKeyDown={handleQtyKeyDown}
              className="h-7 w-10 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="w-8 cursor-text text-center font-medium tabular-nums hover:underline"
              onClick={() => {
                setQtyInput(String(item.quantity))
                setEditingQty(true)
              }}
            >
              {item.quantity}
            </button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => onUpdateQuantity(item.product_id, item.quantity + 1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {formatRupiah(subtotal)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(item.product_id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  )
}
