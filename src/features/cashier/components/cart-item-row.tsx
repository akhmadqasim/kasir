import { useState } from "react"
import { Minus, Plus, Smartphone, Zap, Droplet, ShieldCheck, Wallet, Wifi, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import type { CartItem } from "../types"
import { formatRupiah } from "../utils"

const PPOB_ICONS: Record<string, React.ElementType> = {
  pulsa: Smartphone,
  data: Wifi,
  pln: Zap,
  pdam: Droplet,
  bpjs: ShieldCheck,
  emoney: Wallet,
}

interface CartItemRowProps {
  item: CartItem
  onUpdateQuantity: (cartId: string, qty: number) => void
  onRemove: (cartId: string) => void
  onEdit: (item: CartItem) => void
  hasDiscount?: boolean
}

export function CartItemRow({
  item,
  onUpdateQuantity,
  onRemove,
  onEdit,
  hasDiscount,
}: CartItemRowProps) {
  const [editingQty, setEditingQty] = useState(false)
  const [qtyInput, setQtyInput] = useState("")
  const subtotal = item.product_price * item.quantity

  const handleQtyBlur = () => {
    const parsed = parseInt(qtyInput, 10)
    if (!isNaN(parsed) && parsed >= 1) {
      onUpdateQuantity(item.cart_id, parsed)
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

  const truncatePpobName= (name: string) => {
    const parts = name.split(" - ")
    if (parts.length > 1) {
      return parts.slice(1).join(" - ").substring(0, 40)
    }
    return name.substring(0, 40)
  }

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onEdit(item)}
    >
      <TableCell className="whitespace-normal">
        <div className="min-w-0">
          <p className="font-medium leading-snug">
            {item.is_ppob ? truncatePpobName(item.product_name) : item.product_name}
          </p>
          {item.is_ppob ? (
            <div className="flex items-center gap-1 mt-0.5">
              {(() => {
                const Icon = PPOB_ICONS[item.service_type ?? ""] ?? Smartphone
                return <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
              })()}
              <p className="text-xs text-muted-foreground">
                {item.service_ref}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {formatRupiah(item.product_price)} / {item.unit}
            </p>
          )}
          {hasDiscount && (
            <p className="text-xs text-destructive font-medium">Diskon aktif</p>
          )}
        </div>
      </TableCell>
      <TableCell>
        {item.is_ppob ? (
          <div className="text-center font-medium tabular-nums">1</div>
        ) : (
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onUpdateQuantity(item.cart_id, item.quantity - 1)}
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
              onClick={() => onUpdateQuantity(item.cart_id, item.quantity + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {formatRupiah(subtotal)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(item.cart_id)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  )
}
