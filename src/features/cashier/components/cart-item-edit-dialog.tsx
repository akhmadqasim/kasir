import { useEffect, useState } from "react"
import { Minus, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCartStore } from "../hooks/use-cart-store"
import type { CartItem } from "../types"
import { formatRupiah } from "../utils"

interface CartItemEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: CartItem | null
}

export function CartItemEditDialog({
  open,
  onOpenChange,
  item,
}: CartItemEditDialogProps) {
  if (!item) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <CartItemEditBody open={open} item={item} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function CartItemEditBody({
  open,
  item,
  onOpenChange,
}: {
  open: boolean
  item: CartItem
  onOpenChange: (open: boolean) => void
}) {
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const setItemDiscount = useCartStore((s) => s.setItemDiscount)
  const itemDiscounts = useCartStore((s) => s.itemDiscounts)

  const disc = itemDiscounts[item.cart_id]
  const [qty, setQty] = useState(item.quantity)
  const [qtyRaw, setQtyRaw] = useState(String(item.quantity))
  const [discType, setDiscType] = useState<"fixed" | "percentage">(disc?.type ?? "fixed")
  const [discRaw, setDiscRaw] = useState(disc ? String(disc.value) : "")

  const lineTotal = item.product_price * qty
  const qtyInputId = `cart-item-edit-qty-${item.cart_id}`
  const discValue = Number(discRaw) || 0
  const discAmount =
    discType === "percentage"
      ? Math.round(lineTotal * Math.min(discValue, 100) / 100)
      : Math.min(discValue, lineTotal)
  const finalTotal = Math.max(0, lineTotal - discAmount)

  const handleQtyChange = (newQty: number) => {
    const validated = Math.max(1, newQty)
    setQty(validated)
    setQtyRaw(String(validated))
  }

  const handleQtyInputChange = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, "")
    setQtyRaw(cleaned)

    if (!cleaned) return

    const parsed = parseInt(cleaned, 10)
    if (!isNaN(parsed)) {
      setQty(Math.max(1, parsed))
    }
  }

  const handleDiscChange = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, "")
    setDiscRaw(cleaned)
  }

  const formatDiscDisplay = (raw: string): string => {
    if (!raw || discType === "percentage") return raw
    const num = Number(raw)
    if (isNaN(num) || num === 0) return raw
    return num.toLocaleString("id-ID")
  }

  const handleTypeChange = (newType: "fixed" | "percentage") => {
    setDiscType(newType)
    setDiscRaw("")
  }

  const handleSave = () => {
    const normalizedQty = Math.max(1, parseInt(qtyRaw || String(qty), 10) || qty)
    setQty(normalizedQty)
    setQtyRaw(String(normalizedQty))

    // Update quantity
    if (!item.is_ppob) {
      updateQuantity(item.cart_id, normalizedQty)
    }

    // Update discount
    const parsedDisc = Number(discRaw) || 0
    const clampedDisc =
      discType === "percentage" ? Math.min(parsedDisc, 100) : parsedDisc
    if (clampedDisc > 0) {
      setItemDiscount(item.cart_id, { type: discType, value: clampedDisc })
    } else {
      setItemDiscount(item.cart_id, null)
    }

    onOpenChange(false)
  }

  const handleReset = () => {
    setDiscType("fixed")
    setDiscRaw("")
    setItemDiscount(item.cart_id, null)
  }

  useEffect(() => {
    if (!open || item.is_ppob) return

    setQty(item.quantity)
    setQtyRaw(String(item.quantity))
    setDiscType(disc?.type ?? "fixed")
    setDiscRaw(disc ? String(disc.value) : "")

    const timer = setTimeout(() => {
      const input = document.getElementById(qtyInputId) as HTMLInputElement | null
      input?.focus()
      input?.select()
    }, 50)

    return () => clearTimeout(timer)
  }, [disc, item.is_ppob, item.quantity, open, qtyInputId])

  return (
    <>
      <DialogHeader>
        <DialogTitle className="leading-snug">
          {item.product_name}
        </DialogTitle>
      </DialogHeader>

        {/* Price info */}
        <div className="text-sm text-muted-foreground">
          Harga: {formatRupiah(item.product_price)} / {item.unit ?? "pcs"}
        </div>

        {/* Quantity */}
        {!item.is_ppob && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Jumlah</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => handleQtyChange(qty - 1)}
                disabled={qty <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id={qtyInputId}
                type="text"
                inputMode="numeric"
                className="h-9 w-20 text-center text-lg font-semibold tabular-nums"
                value={qtyRaw}
                autoFocus
                onChange={(e) => handleQtyInputChange(e.target.value)}
                onBlur={() => setQtyRaw(String(qty))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave()
                }}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => handleQtyChange(qty + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Discount */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Diskon</Label>
          <div className="flex items-center gap-2">
            <Select value={discType} onValueChange={(v) => handleTypeChange(v as "fixed" | "percentage")}>
              <SelectTrigger className="h-9 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                <SelectItem value="percentage">Persen (%)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="text"
              inputMode="numeric"
              className="h-9 flex-1 text-right tabular-nums"
              placeholder={
                discType === "percentage" ? "Persentase (%)" : "Nominal (Rp)"
              }
              value={formatDiscDisplay(discRaw)}
              onChange={(e) => handleDiscChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave()
              }}
            />
          </div>
          {discAmount > 0 && (
            <p className="text-sm text-destructive tabular-nums">
              Potongan: -{formatRupiah(discAmount)}
            </p>
          )}
        </div>

        <Separator />

        {/* Summary */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatRupiah(lineTotal)}</span>
          </div>
          {discAmount > 0 && (
            <div className="flex justify-between text-destructive">
              <span>Diskon</span>
              <span className="tabular-nums">-{formatRupiah(discAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatRupiah(finalTotal)}</span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {discAmount > 0 && (
            <Button variant="outline" onClick={handleReset}>
              Reset Diskon
            </Button>
          )}
          <Button onClick={handleSave}>Simpan</Button>
        </DialogFooter>
      </>
  )
}
