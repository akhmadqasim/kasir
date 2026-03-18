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
      <div className="flex h-[calc(100vh-64px)]">
        {/* Left: Cart (60%) */}
        <div className="flex w-[60%] flex-col border-r">
          <CartPanel onPay={() => setPaymentOpen(true)} />
        </div>

        {/* Right: Product Search (40%) */}
        <div className="flex w-[40%] flex-col">
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
