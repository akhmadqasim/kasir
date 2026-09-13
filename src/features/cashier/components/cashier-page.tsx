import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Surface } from "@heroui/react"
import { DoorOpen } from "lucide-react"
import { NavbarActions } from "@/components/layout/app-navbar"
import { useApiQuery } from "@/hooks/use-api"
import { getPrinterSettings } from "@/lib/api/printers"
import { queryKeys } from "@/lib/api/query-keys"
import { useCartStore } from "@/stores/cart-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { CartPanel } from "./cart-panel"
import { ProductSearchPanel } from "./product-search-panel"
import { PaymentDialog } from "./payment-dialog"
import { TransactionSuccessDialog } from "./transaction-success-dialog"
import { OpenShiftDialog } from "@/features/shift/components/open-shift-dialog"
import type { PrinterSettings } from "@/features/settings/types"
import type { TransactionResult } from "../types"

export function CashierPage() {
  const [paymentOpen, setPaymentOpen] = useState(false)
  // The shift dialog is not a state of its own: it is open whenever there is no
  // shift and the cashier has not waved it away. Deriving it means it can never
  // be left open over a shift that has since been opened, and it drops the effect
  // that used to push it open on every render where `needsShift` was true.
  const [shiftDialogDismissed, setShiftDialogDismissed] = useState(false)
  const [productSearchFocusKey, setProductSearchFocusKey] = useState(0)
  const [successResult, setSuccessResult] = useState<TransactionResult | null>(null)
  const clear = useCartStore((s) => s.clear)
  const hasItems = useCartStore((s) => s.items.length > 0)
  const user = useAuthStore((s) => s.user)
  const activeShift = useShiftStore((s) => s.activeShift)
  const fetchActiveShift = useShiftStore((s) => s.fetchActiveShift)
  const queryClient = useQueryClient()

  // Dibaca sekali di sini dan disimpan di cache, supaya dialog sukses tidak
  // menunggu satu permintaan lagi sebelum bisa mulai mencetak. Halaman
  // Pengaturan membatalkan kuncinya saat menyimpan, jadi perubahan tetap sampai.
  const { data: printerSettings } = useApiQuery<PrinterSettings>(
    queryKeys.printers.settings,
    getPrinterSettings,
  )
  const autoPrint = printerSettings
    ? !!printerSettings.auto_print && !!printerSettings.printer_id
    : undefined

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

  const handlePaymentSuccess = useCallback(
    (result: TransactionResult) => {
      setPaymentOpen(false)
      setSuccessResult(result)
      // Barang sudah dibayar. Struk dirender dari `result`, bukan dari keranjang,
      // jadi keranjang (dan salinannya di localStorage) harus langsung kosong
      // supaya tidak bisa ditagih dua kali.
      clear()
    },
    [clear],
  )

  const requestProductSearchFocus = useCallback(() => {
    setProductSearchFocusKey((prev) => prev + 1)
  }, [])

  const handleNewTransaction = useCallback(() => {
    clear()
    setSuccessResult(null)
    requestProductSearchFocus()
    // Checkout menandai katalog basi tanpa memuatnya ulang (lihat
    // `PaymentDialog`); di sinilah ia dimuat ulang — dialognya sudah tertutup,
    // dan hasil pencarian harus menampilkan stok yang baru berkurang sebelum
    // kasir menyentuhnya lagi.
    queryClient.refetchQueries({ queryKey: queryKeys.products.all, type: "active", stale: true })
  }, [clear, queryClient, requestProductSearchFocus])

  const openPayment = useCallback(() => {
    if (needsShift) return
    setPaymentOpen(true)
  }, [needsShift])

  const handlePaymentOpenChange = useCallback(
    (open: boolean) => {
      setPaymentOpen(open)
      if (!open) {
        requestProductSearchFocus()
      }
    },
    [requestProductSearchFocus],
  )

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
      {/* DESIGN.md §5.7 */}
      {needsShift && (
        <NavbarActions>
          <Button size="sm" onPress={() => setShiftDialogDismissed(false)}>
            <DoorOpen />
            Buka Kasir
          </Button>
        </NavbarActions>
      )}

      {/* Dua panel `Surface` di atas kanvas, bukan `div` yang diberi `bg-surface`
          sendiri: kolom isian di dalamnya lalu memakai `variant="secondary"`,
          seperti contoh "In Surface" HeroUI. */}
      <div className="flex h-full flex-col gap-4 lg:grid lg:grid-cols-10">
        {/* Cart (top when stacked, left when side-by-side) */}
        <Surface className="flex min-h-0 flex-1 flex-col overflow-hidden border lg:col-span-4 lg:flex-none">
          <CartPanel
            onPay={openPayment}
            disabled={needsShift}
            shortcutsDisabled={pageDialogOpen}
            onRequestProductSearchFocus={requestProductSearchFocus}
          />
        </Surface>

        {/* Product Search (bottom when stacked, right when side-by-side) */}
        <Surface className="flex min-h-0 flex-1 flex-col overflow-hidden border lg:col-span-6 lg:flex-none">
          <ProductSearchPanel focusKey={productSearchFocusKey} />
        </Surface>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={handlePaymentOpenChange}
        onSuccess={handlePaymentSuccess}
      />

      <TransactionSuccessDialog
        open={successResult !== null}
        result={successResult}
        autoPrint={autoPrint}
        onNewTransaction={handleNewTransaction}
      />

      <OpenShiftDialog open={shiftDialogOpen} onOpenChange={handleShiftDialogOpenChange} />
    </>
  )
}
