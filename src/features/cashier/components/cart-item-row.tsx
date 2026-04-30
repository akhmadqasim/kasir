import { Smartphone, Zap, Droplet, ShieldCheck, Wallet, Wifi, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
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
  onRemove: (cartId: string) => void
  onEdit: (item: CartItem) => void
  hasDiscount?: boolean
}

export function CartItemRow({
  item,
  onRemove,
  onEdit,
  hasDiscount,
}: CartItemRowProps) {
  const subtotal = item.product_price * item.quantity
  const qty = item.is_ppob ? 1 : item.quantity

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
        <div className="flex items-start gap-2 min-w-0">
          {/* Qty badge */}
          <span
            className={cn(
              "mt-0.5 inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-bold tabular-nums transition-colors",
              item.is_ppob
                ? "border border-border bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground shadow-sm"
            )}
          >
            {qty}
          </span>
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
