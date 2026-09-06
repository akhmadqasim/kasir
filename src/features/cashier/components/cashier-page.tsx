import { useCallback, useEffect, useState } from "react"
import { Alert, Button } from "@heroui/react"
import { DoorOpen } from "lucide-react"
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
  // The shift dialog is not a state of its own: it is open whenever there is no
  // shift and the cashier has not waved it away. Deriving it means it can never
  // be left open over a shift that has since been opened, and it drops the effect
  // that used to push it open on every render where `needsShift` was true.
  const [shiftDialogDismissed, setShiftDialogDismissed] = useState(false)
  const [productSearchFocusKey, setProductSearchFocusKey] = useState(0)
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
      fetchActiveShift()
    }
  }, [user, fetchActiveShift])

  const needsShift = !activeShift
  const shiftDialogOpen = needsShift && !shiftDialogDismissed
  // Dialog milik halaman ini menutupi CartPanel, jadi shortcut-nya harus mati.
  const pageDialogOpen = paymentOpen || successResult !== null || shiftDialogOpen

  const handleShiftDialogOpenChange = useCallback((open: boolean) => {
    setShiftDialogDismissed(!open)
  }, [])

  const handlePaymentSuccess = useCallback((result: TransactionResult) => {
    setPaymentOpen(false)
    setSuccessResult(result)
    // Barang sudah dibayar. Struk dirender dari `result`, bukan dari keranjang,
    // jadi keranjang (dan salinannya di localStorage) harus langsung kosong
    // supaya tidak bisa ditagih dua kali.
    clear()
  }, [clear])

  const requestProductSearchFocus = useCallback(() => {
    setProductSearchFocusKey((prev) => prev + 1)
  }, [])

  const handleNewTransaction = useCallback(() => {
    clear()
    setSuccessResult(null)
    requestProductSearchFocus()
  }, [clear, requestProductSearchFocus])

  const openPayment = useCallback(() => {
    if (needsShift) return
    setPaymentOpen(true)
  }, [needsShift])

  const handlePaymentOpenChange = useCallback((open: boolean) => {
    setPaymentOpen(open)
    if (!open) {
      requestProductSearchFocus()
    }
  }, [requestProductSearchFocus])

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
        <Alert className="mb-4" status="warning">
          <Alert.Indicator>
            <DoorOpen className="h-5 w-5" />
          </Alert.Indicator>
          <Alert.Content className="flex items-center justify-between gap-4">
            <Alert.Title className="text-sm">
              Shift belum dibuka — buka shift untuk mulai transaksi
            </Alert.Title>
            <Button size="sm" variant="outline" onPress={() => setShiftDialogDismissed(false)}>
              <DoorOpen className="mr-1 h-4 w-4" />
              Buka Kasir
            </Button>
          </Alert.Content>
        </Alert>
      )}

      <div className="flex h-full flex-col gap-4 lg:grid lg:grid-cols-10">
        {/* Cart (top when stacked, left when side-by-side) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-surface lg:col-span-4 lg:flex-none">
          <CartPanel
            onPay={openPayment}
            disabled={needsShift}
            shortcutsDisabled={pageDialogOpen}
            onRequestProductSearchFocus={requestProductSearchFocus}
          />
        </div>

        {/* Product Search (bottom when stacked, right when side-by-side) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-surface lg:col-span-6 lg:flex-none">
          <ProductSearchPanel focusKey={productSearchFocusKey} />
        </div>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={handlePaymentOpenChange}
        onSuccess={handlePaymentSuccess}
      />

      <TransactionSuccessDialog
        open={successResult !== null}
        result={successResult}
        onNewTransaction={handleNewTransaction}
      />

      <OpenShiftDialog
        open={shiftDialogOpen}
        onOpenChange={handleShiftDialogOpenChange}
      />
    </>
  )
}
