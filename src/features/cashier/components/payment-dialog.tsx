import { useState } from "react"
import { toast } from "sonner"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useCartStore } from "../hooks/use-cart-store"
import { useCreateTransaction } from "../hooks/use-cashier"
import { formatRupiah } from "../utils"
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
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [paymentAmount, setPaymentAmount] = useState("")
  const user = useAuthStore((s) => s.user)
  const items = useCartStore((s) => s.items)
  const getTotal = useCartStore((s) => s.getTotal)
  const createTransaction = useCreateTransaction()

  const total = getTotal()
  const numericPayment = Number(paymentAmount) || 0
  const changeAmount = paymentMethod === "cash" ? numericPayment - total : 0
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  const isCashValid = paymentMethod !== "cash" || numericPayment >= total
  const canConfirm = items.length > 0 && isCashValid && !createTransaction.isPending

  const quickAmounts = getQuickAmounts(total)

  const handleConfirm = () => {
    if (!user) return

    const finalPaymentAmount =
      paymentMethod === "cash" ? numericPayment : total

    createTransaction.mutate(
      {
        input: {
          user_id: user.id,
          items: items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
          payment_method: paymentMethod,
          payment_amount: finalPaymentAmount,
        },
      },
      {
        onSuccess: (result) => {
          onSuccess(result)
          setPaymentAmount("")
          setPaymentMethod("cash")
        },
        onError: () => {
          toast.error("Gagal memproses transaksi")
        },
      }
    )
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setPaymentAmount("")
      setPaymentMethod("cash")
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
          <div className="flex justify-between">
            <span className="font-medium">Total</span>
            <span className="text-xl font-bold tabular-nums">
              {formatRupiah(total)}
            </span>
          </div>
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
                  id="payment-amount"
                  type="number"
                  className="mt-1 h-12 text-lg text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="0"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  min={0}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {quickAmounts.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentAmount(String(amount))}
                  >
                    {amount === total ? "Uang Pas" : formatRupiah(amount)}
                  </Button>
                ))}
              </div>
              {numericPayment > 0 && (
                <div className="rounded-lg bg-muted p-3">
                  <div className="flex justify-between">
                    <span>Kembalian</span>
                    <span
                      className={`text-lg font-bold tabular-nums ${
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

        <DialogFooter>
          <Button
            className="h-12 w-full text-lg font-semibold"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {createTransaction.isPending
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

  const roundUps = [1000, 5000, 10000, 50000, 100000]
  for (const r of roundUps) {
    const rounded = Math.ceil(total / r) * r
    if (rounded > total) {
      amounts.add(rounded)
    }
  }

  return Array.from(amounts).sort((a, b) => a - b).slice(0, 6)
}
