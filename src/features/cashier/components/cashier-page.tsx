import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Surface } from "@heroui/react"
import { DoorOpen } from "lucide-react"
import { id } from "@/i18n/id"
import { NavbarActions } from "@/components/layout/app-navbar"
import { useApiQuery } from "@/hooks/use-api"
import { getPrinterSettings } from "@/lib/api/printers"
import { queryKeys } from "@/lib/api/query-keys"
import { isEditableElement } from "@/lib/dom"
import { toast } from "@/lib/toast"
import { useCartStore } from "@/stores/cart-store"
import { cartLineNets } from "@/stores/cart-totals"
import { OpenShiftDialog, useShiftStore } from "@/features/shift"
import { useAuthStore } from "@/features/auth"
import {
  cartPriceRefreshInFlight,
  priceChangeMessage,
  refreshCartOnVisit,
  refreshCartPricesInBackground,
  takeUnacknowledgedPriceChanges,
} from "../cart-price-refresh"
import { isPpobBelowCost } from "../utils"
import { useDeferredFocus } from "../hooks/use-deferred-focus"
import { CartPanel } from "./cart-panel"
import { ProductSearchPanel } from "./product-search-panel"
import { PaymentDialog } from "./payment/payment-dialog"
import { TransactionSuccessDialog } from "./transaction-success-dialog"
import type { PrinterSettings } from "@/features/settings/types"
import type { CartItem, TransactionResult } from "../types"

export function CashierPage() {
  const [paymentOpen, setPaymentOpen] = useState(false)
  // The shift dialog is not a state of its own: it is open whenever there is no
  // shift and the cashier has not waved it away. Deriving it means it can never
  // be left open over a shift that has since been opened, and it drops the effect
  // that used to push it open on every render where `needsShift` was true.
  const [shiftDialogDismissed, setShiftDialogDismissed] = useState(false)
  const [successResult, setSuccessResult] = useState<TransactionResult | null>(null)
  const clear = useCartStore((s) => s.clear)
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

  // The scan field, reached through this one ref: to focus it on request,
  // and to steer stray keystrokes into it (below).
  const scanInputRef = useRef<HTMLInputElement>(null)
  const requestProductSearchFocus = useDeferredFocus(scanInputRef)

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

  // Checkout charges the catalogue's current price, not the cart's (see
  // `cart-price-refresh.ts`). The cart is repriced in the background on each
  // visit, and a moment after its goods change (a recall included) for lines
  // no lookup priced. Payment waits only for a check already out.
  const visitCheckedRef = useRef(false)
  useEffect(() => {
    if (visitCheckedRef.current) return
    visitCheckedRef.current = true
    refreshCartOnVisit()
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useCartStore.subscribe(({ items }, previous) => {
      if (items === previous.items || goodsKey(items) === goodsKey(previous.items)) return
      clearTimeout(timer)
      if (!items.some((item) => !item.is_ppob)) return
      timer = setTimeout(
        () => refreshCartPricesInBackground({ skipLookupPriced: true }),
        PRICE_CHECK_DELAY_MS,
      )
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  // Set while payment waits for a price check already out, so a second F4 in
  // that moment is dropped instead of acting on the same check twice.
  const paymentCheckRef = useRef(false)
  const openPayment = useCallback(async () => {
    if (needsShift || paymentCheckRef.current) return
    const inFlight = cartPriceRefreshInFlight()
    if (inFlight) {
      paymentCheckRef.current = true
      try {
        await inFlight
      } catch {
        // Catalogue unreachable: checkout still prices the sale itself.
      } finally {
        paymentCheckRef.current = false
      }
    }
    const changes = takeUnacknowledgedPriceChanges()
    if (changes.length > 0) {
      // Payment stays shut once: the cashier quoted the old total, and has
      // to see the new one before taking the money.
      toast.warning(`${priceChangeMessage(changes)} ${id.cashier.checkTotalThenPay}`)
      return
    }
    // The cart may have been emptied, or a dialog opened, while the check ran.
    const { items, itemDiscounts, transactionDiscount } = useCartStore.getState()
    if (items.length === 0) return
    // The server refuses a PPOB line sold below cost; say so before the
    // cashier counts the money, not after. A line's share of the cart
    // discount is a loss too, so it is counted the way the server spreads it.
    const lineNets = cartLineNets(items, itemDiscounts, transactionDiscount)
    const belowCost = items.find((item, index) => isPpobBelowCost(item, lineNets[index]))
    if (belowCost) {
      toast.error(id.cashier.ppobBelowCost(belowCost.product_name))
      return
    }
    if (isModalOpen()) return
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

  // F4 (pay) is bound in CartPanel with the other cart shortcuts, so that it
  // also stays off while one of the panel's own dialogs is open.

  // A printable key on anything that does not take typing goes to the scan
  // field, so a scan never presses a focused button or feeds a typeahead.
  // Focusing during `keydown` makes the browser type the key into the field.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return
      const input = scanInputRef.current
      const active = document.activeElement
      if (!input || active === input) return
      // Another field — the navbar's search, say — keeps what is typed into it.
      if (isEditableElement(active)) return
      // A list or menu with typeahead keeps its keys, as does anything in an
      // open popover, modal or not. The cart grid is no such widget.
      if (active instanceof Element && active.closest(TYPEAHEAD_WIDGET)) return
      // While any modal is up — the page's own, or one of the cart panel's —
      // the keys belong to it, even with focus lost to the body.
      if (isModalOpen()) return
      e.stopPropagation()
      input.focus()
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [])

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
            payBlockedReason={needsShift ? id.cashier.payNeedsShift : undefined}
            shortcutsDisabled={pageDialogOpen}
            onRequestProductSearchFocus={requestProductSearchFocus}
          />
        </Surface>

        {/* Product Search (bottom when stacked, right when side-by-side) */}
        <Surface className="flex min-h-0 flex-1 flex-col overflow-hidden border lg:col-span-6 lg:flex-none">
          <ProductSearchPanel inputRef={scanInputRef} />
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
        paperWidth={printerSettings?.paper_width}
        onNewTransaction={handleNewTransaction}
      />

      <OpenShiftDialog open={shiftDialogOpen} onOpenChange={handleShiftDialogOpenChange} />
    </>
  )
}

/**
 * Focus inside one of these keeps its printable keys: a listbox or menu
 * (HeroUI Select, Dropdown) uses them for typeahead, and `data-trigger` marks
 * an open React Aria popover, including a non-modal one.
 */
const TYPEAHEAD_WIDGET = [
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="combobox"]',
  "[data-trigger]",
].join(", ")

/** How long the cart's goods must sit still before their prices are checked. */
const PRICE_CHECK_DELAY_MS = 500

/** The cart's goods products in order; quantities and PPOB lines do not count. */
function goodsKey(items: readonly CartItem[]): string {
  return items.map((item) => (item.is_ppob ? "" : String(item.product_id ?? ""))).join(",")
}

/**
 * Whether a modal is up: one of this page's, or one the cart panel portals out.
 * A toast is no modal, though React Aria gives it `role="alertdialog"` too; it
 * marks itself `aria-modal="false"`, and is left out by that.
 */
function isModalOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]:not([aria-modal="false"])',
    ) !== null
  )
}
