import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
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
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "../hooks/use-cart-store"
import { useCheckoutTransaction } from "../hooks/use-cashier"
import { formatRupiah, getCartValidationError } from "../utils"
import type { TransactionResult } from "../types"

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: TransactionResult) => void
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "ewallet", label: "E-Wallet" },
  { value: "transfer", label: "Transfer Bank" },
] as const

export function PaymentDialog({
  open,
  onOpenChange,
  onSuccess,
}: PaymentDialogProps) {
  const queryClient = useQueryClient()
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [paymentAmount, setPaymentAmount] = useState("")
  const [displayPayment, setDisplayPayment] = useState("")
  const [notes, setNotes] = useState("")
  const paymentInputRef = useRef<HTMLInputElement>(null)
  const user = useAuthStore((s) => s.user)
  const activeShift = useShiftStore((s) => s.activeShift)
  const items = useCartStore((s) => s.items)
  const getTotal = useCartStore((s) => s.getTotal)
  const getSubtotal = useCartStore((s) => s.getSubtotal)
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount)
  const getItemDiscountAmount = useCartStore((s) => s.getItemDiscountAmount)
  const getTransactionDiscountAmount = useCartStore((s) => s.getTransactionDiscountAmount)
  const checkoutTransaction = useCheckoutTransaction()

  const total = getTotal()
  const subtotal = getSubtotal()
  const totalDiscount = getTotalDiscount()
  const numericPayment = Number(paymentAmount) || 0
  const changeAmount = paymentMethod === "cash" ? numericPayment - total : 0
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const cartValidationError = getCartValidationError(items)

  const isCashValid = paymentMethod !== "cash" || numericPayment >= total
  const canConfirm =
    items.length > 0 &&
    !cartValidationError &&
    isCashValid &&
    !checkoutTransaction.isPending

  const quickAmounts = getQuickAmounts(total)

  // Auto-focus payment input when dialog opens
  useEffect(() => {
    if (open && paymentMethod === "cash") {
      setTimeout(() => paymentInputRef.current?.focus(), 100)
    }
  }, [open, paymentMethod])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canConfirm) {
      e.preventDefault()
      handleConfirm()
    }
  }

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat("id-ID").format(num)
  }

  const handlePaymentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "")
    if (raw === "") {
      setPaymentAmount("")
      setDisplayPayment("")
      return
    }
    const num = Number(raw)
    setPaymentAmount(String(num))
    setDisplayPayment(formatNumber(num))
  }

  const handleQuickAmount = (amount: number) => {
    setPaymentAmount(String(amount))
    setDisplayPayment(formatNumber(amount))
  }

  const handleConfirm = () => {
    if (!user) return

    const finalPaymentAmount =
      paymentMethod === "cash" ? numericPayment : total

    checkoutTransaction.mutate(
      {
        input: {
          user_id: user.id,
          items: items.map((item) => ({
            product_id: item.is_ppob ? undefined : item.product_id,
            quantity: item.quantity,
            product_name: item.is_ppob ? item.product_name : undefined,
            product_price: item.is_ppob ? item.product_price : undefined,
            buy_price: item.buy_price,
            item_discount: getItemDiscountAmount(item.cart_id) || undefined,
            service_type: item.service_type,
            service_ref: item.service_ref,
            ppob_product_id: item.ppob_product_id,
            ppob_product_code: item.ppob_product_code,
            ppob_inquiry_id: item.ppob_inquiry_id,
            ppob_payment_code: item.ppob_payment_code,
            ppob_flag_id: item.ppob_flag_id,
          })),
          payment_method: paymentMethod,
          payment_amount: finalPaymentAmount,
          transaction_discount: getTransactionDiscountAmount() || undefined,
          shift_id: activeShift?.id,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: ["list_transactions"] })
          queryClient.invalidateQueries({ queryKey: ["search_products"] })
          onSuccess(result)
          setPaymentAmount("")
          setDisplayPayment("")
          setPaymentMethod("cash")
          setNotes("")
        },
        onError: (err) => {
          toast.error(`Gagal memproses transaksi: ${err.message}`)
        },
      }
    )
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setPaymentAmount("")
      setDisplayPayment("")
      setPaymentMethod("cash")
      setNotes("")
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ringkasan Pesanan</DialogTitle>
        </DialogHeader>

        {/* Order summary */}
        <div className="rounded-lg bg-muted p-4">
          <div className="flex justify-between text-sm">
            <span>{itemCount} item</span>
          </div>
          <Separator className="my-2" />
          {totalDiscount > 0 ? (
            <>
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatRupiah(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-destructive">
                <span>Diskon</span>
                <span className="tabular-nums">-{formatRupiah(totalDiscount)}</span>
              </div>
              <Separator className="my-2" />
            </>
          ) : null}
          <div className="flex justify-between">
            <span className="font-medium">Total</span>
            <span className="text-xl font-bold tabular-nums">
              {formatRupiah(total)}
            </span>
          </div>
          {cartValidationError && (
            <p className="mt-3 text-sm text-destructive">{cartValidationError}</p>
          )}
        </div>

        {/* Payment Method */}
        <div>
          <Label className="mb-2 block">Metode Pembayaran</Label>
          <Tabs value={paymentMethod} onValueChange={setPaymentMethod}>
            <TabsList className="grid w-full grid-cols-4">
              {PAYMENT_METHODS.map((method) => (
                <TabsTrigger key={method.value} value={method.value}>
                  {method.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="cash" className="mt-4 space-y-3">
              <div>
                <Label htmlFor="payment-amount">Jumlah Bayar</Label>
                <Input
                  ref={paymentInputRef}
                  id="payment-amount"
                  type="text"
                  inputMode="numeric"
                  className="mt-1 !h-12 !text-lg !font-bold text-right tabular-nums"
                  placeholder="0"
                  value={displayPayment}
                  onChange={handlePaymentChange}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-wrap gap-2 flex-1">
                  {quickAmounts.filter(a => a !== total).map((amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickAmount(amount)}
                    >
                      {formatRupiah(amount)}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="default"
                  className="h-auto min-h-[4rem] px-6 text-base font-bold self-stretch"
                  onClick={() => handleQuickAmount(total)}
                >
                  Uang Pas
                </Button>
              </div>
              {numericPayment > 0 && (
                <div className="rounded-lg bg-muted p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Kembalian</span>
                    <span
                      className={`text-base font-bold tabular-nums ${
                        changeAmount < 0 ? "text-destructive" : "text-green-600"
                      }`}
                    >
                      {formatRupiah(Math.max(0, changeAmount))}
                    </span>
                  </div>
                </div>
              )}
            </TabsContent>

            {["qris", "ewallet", "transfer"].map((method) => (
              <TabsContent key={method} value={method} className="mt-4">
                <div className="rounded-lg bg-muted p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Pembayaran sebesar
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {formatRupiah(total)}
                  </p>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transaction-notes">Keterangan (opsional)</Label>
          <Textarea
            id="transaction-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Tambahkan catatan untuk transaksi ini..."
            rows={2}
            className="resize-none"
          />
        </div>

        <DialogFooter>
          <Button
            className="h-12 w-full text-lg font-semibold"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {checkoutTransaction.isPending
              ? "Memproses..."
              : "Proses Pembayaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getQuickAmounts(total: number): number[] {
  const amounts = new Set<number>()
  amounts.add(total) // Uang Pas

  const roundUps = [1000, 5000, 10000, 20000, 50000, 100000]
  for (const r of roundUps) {
    const rounded = Math.ceil(total / r) * r
    if (rounded > total) {
      amounts.add(rounded)
    }
  }

  return Array.from(amounts).sort((a, b) => a - b).slice(0, 6)
}
