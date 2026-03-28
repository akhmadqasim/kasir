import { useCallback, useEffect, useState } from "react"
import { useCartStore } from "../hooks/use-cart-store"
import { CartPanel } from "./cart-panel"
import { ProductSearchPanel } from "./product-search-panel"
import { PaymentDialog } from "./payment-dialog"
import { TransactionSuccessDialog } from "./transaction-success-dialog"
import type { TransactionResult } from "../types"

export function CashierPage() {
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [successResult, setSuccessResult] = useState<TransactionResult | null>(
    null
  )
  const clear = useCartStore((s) => s.clear)
  const hasItems = useCartStore((s) => s.items.length > 0)

  const handlePaymentSuccess = useCallback((result: TransactionResult) => {
    setPaymentOpen(false)
    setSuccessResult(result)
  }, [])

  const handleNewTransaction = useCallback(() => {
    clear()
    setSuccessResult(null)
  }, [clear])

  const openPayment = useCallback(() => setPaymentOpen(true), [])

  // F4 shortcut to open payment dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F4" && hasItems && !paymentOpen && !successResult) {
        e.preventDefault()
        setPaymentOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hasItems, paymentOpen, successResult])

  return (
    <>
      <div className="grid h-full grid-cols-10 gap-4">
        {/* Left: Cart (4/10 = 40%) */}
        <div className="col-span-4 flex flex-col overflow-hidden rounded-xl border bg-card">
          <CartPanel onPay={openPayment} />
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
    </>
  )
}
