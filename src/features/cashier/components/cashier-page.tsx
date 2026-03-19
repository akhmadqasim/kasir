import { useState } from "react"
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

  const handlePaymentSuccess = (result: TransactionResult) => {
    setPaymentOpen(false)
    setSuccessResult(result)
  }

  const handleNewTransaction = () => {
    clear()
    setSuccessResult(null)
  }

  return (
    <>
      <div className="grid h-full grid-cols-12 gap-4">
        {/* Left: Cart (4/12) */}
        <div className="col-span-4 flex flex-col overflow-hidden rounded-xl border bg-card">
          <CartPanel onPay={() => setPaymentOpen(true)} />
        </div>

        {/* Right: Product Search (8/12) */}
        <div className="col-span-8 flex flex-col overflow-hidden rounded-xl border bg-card">
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
