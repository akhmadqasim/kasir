import { useCallback, useEffect, useState } from "react"
import { DoorOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCartStore } from "../hooks/use-cart-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { CartPanel } from "./cart-panel"
import { ProductSearchPanel } from "./product-search-panel"
import { PaymentDialog } from "./payment-dialog"
import { TransactionSuccessDialog } from "./transaction-success-dialog"
import { OpenShiftDialog } from "@/features/shift/components/open-shift-dialog"
import type { TransactionResult } from "../types"

export function CashierPage() {
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false)
  const [successResult, setSuccessResult] = useState<TransactionResult | null>(
    null
  )
  const clear = useCartStore((s) => s.clear)
  const hasItems = useCartStore((s) => s.items.length > 0)
  const user = useAuthStore((s) => s.user)
  const activeShift = useShiftStore((s) => s.activeShift)
  const fetchActiveShift = useShiftStore((s) => s.fetchActiveShift)

  // Fetch active shift on mount / user change
  useEffect(() => {
    if (user) {
      fetchActiveShift(user.id)
    }
  }, [user, fetchActiveShift])

  const needsShift = !activeShift

  // Auto-open shift dialog when entering cashier without active shift
  useEffect(() => {
    if (needsShift) {
      setShiftDialogOpen(true)
    }
  }, [needsShift])

  const handlePaymentSuccess = useCallback((result: TransactionResult) => {
    setPaymentOpen(false)
    setSuccessResult(result)
  }, [])

  const handleNewTransaction = useCallback(() => {
    clear()
    setSuccessResult(null)
  }, [clear])

  const openPayment = useCallback(() => {
    if (needsShift) return
    setPaymentOpen(true)
  }, [needsShift])

  // F4 shortcut to open payment dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F4" && hasItems && !paymentOpen && !successResult && !needsShift) {
        e.preventDefault()
        setPaymentOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hasItems, paymentOpen, successResult, needsShift])

  return (
    <>
      {/* Banner when no shift */}
      {needsShift && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex items-center gap-2">
            <DoorOpen className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Shift belum dibuka — buka shift untuk mulai transaksi
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/50"
            onClick={() => setShiftDialogOpen(true)}
          >
            <DoorOpen className="mr-1 h-4 w-4" />
            Buka Kasir
          </Button>
        </div>
      )}

      <div className="grid h-full grid-cols-10 gap-4">
        {/* Left: Cart (4/10 = 40%) */}
        <div className="col-span-4 flex flex-col overflow-hidden rounded-xl border bg-card">
          <CartPanel onPay={openPayment} disabled={needsShift} />
        </div>

        {/* Right: Product Search (6/10 = 60%) */}
        <div className="col-span-6 flex flex-col overflow-hidden rounded-xl border bg-card">
          <ProductSearchPanel />
        </div>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        onSuccess={handlePaymentSuccess}
      />

      <TransactionSuccessDialog
        open={successResult !== null}
        result={successResult}
        onNewTransaction={handleNewTransaction}
      />

      <OpenShiftDialog
        open={shiftDialogOpen}
        onOpenChange={setShiftDialogOpen}
      />
    </>
  )
}
