import type { KeyboardEvent } from "react"
import { useCallback, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import { queryKeys } from "@/lib/api/query-keys"
import { getSalesSettings } from "@/lib/api/settings"
import { useApiQuery } from "@/hooks/use-api"
import type { SalesSettings } from "@/features/settings/types"
import { useAuthStore } from "@/features/auth"
import { useCartStore } from "@/stores/cart-store"
import { useCheckoutTransaction } from "../../hooks/use-cashier"
import type { CartItem, TransactionChannel, TransactionResult } from "../../types"
import { buildCheckoutInput } from "./checkout-input"
import { resolveDefaultPaymentMethod } from "./payment-methods"
import {
  createInitialPaymentSplits,
  remainingAmountFor,
  resolveActivePaymentMethod,
  summarizePayment,
  togglePaymentMethod,
  withSplit,
  type PaymentSplitForm,
} from "./payment-splits"
import { useAmountEntryGuard } from "./use-amount-entry-guard"
import { usePaymentShortcuts } from "./use-payment-shortcuts"

/**
 * A sale handed to the dialog by prop instead of read from the cart.
 *
 * The PPOB page rings its one confirmed line up through this same dialog. The
 * cashier's cart may hold someone else's half-finished sale at that moment,
 * so the line, the channel it is booked in and the `Idempotency-Key` for it
 * all arrive here — and the cart is never read, charged or cleared.
 */
export interface DirectSale {
  items: CartItem[]
  channel: TransactionChannel
  /** Minted when the sale started; reused by every retry of it. */
  idempotencyKey: string
}

function directSaleTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.product_price * item.quantity, 0)
}

/** A Mitra transaction PIN is 4–6 digits. */
const PPOB_PIN_PATTERN = /^\d{4,6}$/

interface UsePaymentFormArgs {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: TransactionResult) => void
  /** Charge this instead of the cart. See [`DirectSale`]. */
  sale?: DirectSale
}

/**
 * The state behind the payment dialog and the checkout call itself. The split
 * rules live in `payment-splits.ts`, the keyboard in `usePaymentShortcuts`
 * and `useAmountEntryGuard`; `payment-dialog.tsx` only lays this out.
 */
export function usePaymentForm({ open, onOpenChange, onSuccess, sale }: UsePaymentFormArgs) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  // The session-scoped slice, not `GET /settings`: that one is admin-only.
  const salesSettingsQuery = useApiQuery<SalesSettings>(queryKeys.settings.sales, getSalesSettings)
  const defaultPaymentMethod = resolveDefaultPaymentMethod(
    salesSettingsQuery.data?.default_payment_method,
  )
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitForm[]>(() =>
    createInitialPaymentSplits(
      defaultPaymentMethod,
      sale ? directSaleTotal(sale.items) : useCartStore.getState().getCartTotals().total,
    ),
  )
  const [requestedPaymentMethod, setActivePaymentMethod] = useState(defaultPaymentMethod)
  // The method this opening of the dialog started on, for the autofocus.
  const [openedOn, setOpenedOn] = useState(defaultPaymentMethod)
  // Whether the cashier has touched the payment yet (picked a method, typed an
  // amount or a bank) during this opening. Until then a late default may still
  // replace the starting one.
  const [hasChosen, setHasChosen] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const [notes, setNotes] = useState("")
  const [ppobPin, setPpobPin] = useState("")
  const cartItems = useCartStore((s) => s.items)
  const getCartTotals = useCartStore((s) => s.getCartTotals)
  const getItemDiscountAmount = useCartStore((s) => s.getItemDiscountAmount)
  const getTransactionDiscountAmount = useCartStore((s) => s.getTransactionDiscountAmount)
  const checkoutTransaction = useCheckoutTransaction(sale?.idempotencyKey)
  const isPending = checkoutTransaction.isPending

  // A direct sale is charged as handed in: its line is already priced by the
  // PPOB markup, and the cart's discounts are not its discounts.
  const items = sale?.items ?? cartItems
  const saleTotal = sale ? directSaleTotal(sale.items) : 0
  const { total, subtotal, totalDiscount } = sale
    ? { total: saleTotal, subtotal: saleTotal, totalDiscount: 0 }
    : getCartTotals()

  // Every opening starts on the configured default. Adjusted during render
  // rather than in an effect, so the dialog never paints one frame on cash
  // before jumping to QRIS. The total is known only now, which is why the
  // initial state above cannot do this for a later opening.
  const startOn = (method: string) => {
    setPaymentSplits(createInitialPaymentSplits(method, total))
    setActivePaymentMethod(method)
    setOpenedOn(method)
  }
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setHasChosen(false)
      startOn(defaultPaymentMethod)
    }
  } else if (open && !hasChosen && defaultPaymentMethod !== openedOn) {
    // Mounted already open (the PPOB page's checkout) before `GET
    // /settings/sales` answered: the dialog started on cash, the fallback.
    // Once the configured default arrives it takes over — unless the cashier
    // has already chosen, and their choice is not ours to undo.
    startOn(defaultPaymentMethod)
  }

  const payment = useMemo(() => summarizePayment(paymentSplits, total), [paymentSplits, total])
  const activePaymentMethod = resolveActivePaymentMethod(paymentSplits, requestedPaymentMethod)

  // A cart holding a PPOB line must carry the Mitra PIN — asked for here, at
  // the moment of sale, never read quietly from Pengaturan.
  const hasPpobItems = items.some((item) => item.is_ppob)
  const isPpobPinValid = PPOB_PIN_PATTERN.test(ppobPin)
  const canConfirm =
    items.length > 0 && payment.isValid && (!hasPpobItems || isPpobPinValid) && !isPending

  const updateSplit = useCallback((method: string, next: Partial<PaymentSplitForm>) => {
    setHasChosen(true)
    setPaymentSplits((current) => withSplit(current, method, next))
  }, [])

  const handleAmountChange = useCallback(
    (method: string, value: number | null) =>
      updateSplit(method, { amount: value, selected: true }),
    [updateSplit],
  )

  const handleBankNameChange = useCallback(
    (method: string, value: string) => updateSplit(method, { bank_name: value, selected: true }),
    [updateSplit],
  )

  const handleQuickRoundAmount = useCallback(
    (amount: number) => updateSplit(activePaymentMethod, { amount, selected: true }),
    [activePaymentMethod, updateSplit],
  )

  const handleSetRemainingAmount = useCallback(() => {
    updateSplit(activePaymentMethod, {
      amount: remainingAmountFor(paymentSplits, activePaymentMethod, total),
      selected: true,
    })
  }, [activePaymentMethod, paymentSplits, total, updateSplit])

  const handleExactCash = useCallback(
    () => updateSplit("cash", { amount: total, selected: true }),
    [total, updateSplit],
  )

  /** Toggles `method` like a click on its button; returns the method now active. */
  const handleMethodClick = useCallback(
    (method: string): string => {
      const toggled = togglePaymentMethod(paymentSplits, method, total, activePaymentMethod)
      setHasChosen(true)
      setPaymentSplits(toggled.splits)
      setActivePaymentMethod(toggled.active)
      return toggled.active
    },
    [activePaymentMethod, paymentSplits, total],
  )

  const { registerAmountInput } = usePaymentShortcuts({
    open,
    openedOn,
    isSingleCashSelection: payment.isSingleCashSelection,
    onExactCash: handleExactCash,
    onToggleMethod: handleMethodClick,
  })

  const resetForm = useCallback(() => {
    setPaymentSplits(createInitialPaymentSplits())
    setNotes("")
    setPpobPin("")
  }, [])

  const handleConfirm = useCallback(() => {
    if (!user) return

    checkoutTransaction.mutate(
      buildCheckoutInput({
        items,
        payment,
        itemDiscount: (item) => (sale ? 0 : getItemDiscountAmount(item.cart_id)),
        transactionDiscount: sale ? 0 : getTransactionDiscountAmount(),
        // The cart is booked as `sales` (the server's default); a direct sale
        // names its own channel.
        channel: sale?.channel,
        notes,
        // Only sent when the sale actually needs it — a cart with no PPOB
        // line ignores this field on the server too, but there is no reason
        // to send a PIN the sale never uses.
        ppobPin: hasPpobItems ? ppobPin : undefined,
      }),
      {
        onSuccess: (result) => {
          // A sale moves stock, the transaction list, the shift's drawer and
          // every dashboard panel. The keys are prefixes, so one call each
          // covers the whole resource.
          //
          // Products are marked stale but not refetched here: the only live
          // observer is the catalog beside this dialog, and reloading its 30
          // tiles while the success dialog animates in is the jank the cashier
          // sees. `CashierPage` refetches it when that dialog closes.
          queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
          // A direct sale moves no stock.
          if (!sale) {
            queryClient.invalidateQueries({ queryKey: queryKeys.products.all, refetchType: "none" })
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
          onSuccess(result)
          resetForm()
        },
        onError: (err) => {
          toast.error(id.cashier.checkoutFailed(err.message))
        },
      },
    )
  }, [
    user,
    checkoutTransaction,
    items,
    payment,
    sale,
    getItemDiscountAmount,
    getTransactionDiscountAmount,
    notes,
    hasPpobItems,
    ppobPin,
    queryClient,
    onSuccess,
    resetForm,
  ])

  const submitIfReady = useCallback(() => {
    if (canConfirm) handleConfirm()
  }, [canConfirm, handleConfirm])

  const handleScanRejected = useCallback(
    (method: string) => updateSplit(method, { amount: null, selected: true }),
    [updateSplit],
  )

  const { handleAmountKeyDown, resetAmountEntry } = useAmountEntryGuard({
    onRemainingAmount: handleSetRemainingAmount,
    onScanRejected: handleScanRejected,
    onSubmit: submitIfReady,
  })

  // Enter in the PIN field pays like Enter in an amount field — without the
  // scanner check, because a PIN is typed by hand, not scanned.
  const handlePinKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      submitIfReady()
    },
    [submitIfReady],
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      // Esc or the close button while the sale is being booked would hide a
      // checkout that is still going to succeed (and then pop the receipt
      // over an empty screen). The dialog stays until the answer is in; the
      // dialog also disables both while `isPending`, this is the backstop.
      if (!isOpen && isPending) return
      resetAmountEntry()
      if (!isOpen) {
        resetForm()
        setActivePaymentMethod("cash")
      }
      onOpenChange(isOpen)
    },
    [isPending, onOpenChange, resetAmountEntry, resetForm],
  )

  return {
    // Totals
    total,
    subtotal,
    totalDiscount,
    // Splits
    paymentSplits,
    selectedPaymentSplits: payment.selectedPaymentSplits,
    isSingleCashSelection: payment.isSingleCashSelection,
    primaryPaymentAmount: payment.primaryPaymentAmount,
    changeAmount: payment.changeAmount,
    splitError: payment.splitError,
    splitCashChange: payment.splitCashChange,
    hasImplausibleAmount: payment.hasImplausibleAmount,
    setActivePaymentMethod,
    // Handlers
    registerAmountInput,
    handleAmountChange,
    handleAmountKeyDown,
    handleBankNameChange,
    handleMethodClick,
    handleQuickRoundAmount,
    handleSetRemainingAmount,
    handleConfirm,
    handleOpenChange,
    // Notes
    notes,
    setNotes,
    // PPOB PIN
    hasPpobItems,
    ppobPin,
    setPpobPin,
    handlePinKeyDown,
    // Confirm
    canConfirm,
    isPending,
  }
}
