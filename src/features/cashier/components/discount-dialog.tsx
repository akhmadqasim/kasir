import { useEffect, useState } from "react"
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
import { formatRupiah } from "../utils"

interface DiscountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function parseDiscount(raw: string, type: "fixed" | "percentage"): number {
  const num = Number(raw) || 0
  if (type === "percentage") return Math.min(Math.max(num, 0), 100)
  return Math.max(num, 0)
}

export function DiscountDialog({ open, onOpenChange }: DiscountDialogProps) {
  const transactionDiscount = useCartStore((s) => s.transactionDiscount)
  const setTransactionDiscount = useCartStore((s) => s.setTransactionDiscount)
  const getSubtotal = useCartStore((s) => s.getSubtotal)
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount)
  const getTotal = useCartStore((s) => s.getTotal)
  const getItemDiscountsTotal = useCartStore((s) => s.getItemDiscountsTotal)

  const [txnDiscType, setTxnDiscType] = useState<"fixed" | "percentage">("fixed")
  const [txnRaw, setTxnRaw] = useState("")

  useEffect(() => {
    if (open) {
      setTxnDiscType(transactionDiscount?.type ?? "fixed")
      setTxnRaw(transactionDiscount ? String(transactionDiscount.value) : "")
    }
  }, [open, transactionDiscount])

  const subtotal = getSubtotal()
  const itemDiscountsTotal = getItemDiscountsTotal()
  const totalDiscount = getTotalDiscount()
  const finalTotal = getTotal()

  const handleTxnChange = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, "")
    setTxnRaw(cleaned)
    const parsed = parseDiscount(cleaned, txnDiscType)
    setTransactionDiscount(parsed > 0 ? { type: txnDiscType, value: parsed } : null)
  }

  const formatTxnDisplay = (raw: string): string => {
    if (!raw || txnDiscType === "percentage") return raw
    const num = Number(raw)
    if (isNaN(num) || num === 0) return raw
    return num.toLocaleString("id-ID")
  }

  const handleToggleType = (newType: "fixed" | "percentage") => {
    setTxnDiscType(newType)
    setTxnRaw("")
    setTransactionDiscount(null)
  }

  const handleReset = () => {
    setTxnRaw("")
    setTransactionDiscount(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Diskon Total Transaksi</DialogTitle>
        </DialogHeader>

        {/* Transaction-level discount */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Diskon</Label>
          <div className="flex items-center gap-2">
            <Select value={txnDiscType} onValueChange={(v) => handleToggleType(v as "fixed" | "percentage")}>
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
              placeholder={txnDiscType === "percentage" ? "Persentase (%)" : "Nominal (Rp)"}
              value={formatTxnDisplay(txnRaw)}
              onChange={(e) => handleTxnChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpenChange(false)
              }}
              autoFocus
            />
          </div>
        </div>

        <Separator />

        {/* Summary */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatRupiah(subtotal)}</span>
          </div>
          {itemDiscountsTotal > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Diskon Per Item</span>
              <span className="tabular-nums">-{formatRupiah(itemDiscountsTotal)}</span>
            </div>
          )}
          {totalDiscount > 0 && (
            <div className="flex justify-between text-destructive">
              <span>Total Diskon</span>
              <span className="tabular-nums">-{formatRupiah(totalDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>Total Akhir</span>
            <span className="tabular-nums">{formatRupiah(finalTotal)}</span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {transactionDiscount && (
            <Button variant="outline" onClick={handleReset}>
              Reset
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Selesai</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
