import type { KeyboardEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/toast"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { useCheckoutTransaction } from "../../hooks/use-cashier"
import {
  EMPTY_AMOUNT_ENTRY_TIMING,
  isImplausiblePaymentAmount,
  isScannerBurstEntry,
  trackAmountEntry,
} from "../../payment-behavior"
import type { PaymentSplitInput, TransactionResult } from "../../types"

/**
 * `shortcut` is the letter behind Alt that toggles the method — Alt, not
 * Ctrl, because Ctrl+A/S/W already mean select-all/save/close-tab to the
 * webview, and not a bare letter because the bank and notes fields take
 * typing. Q/W/A/S/Z sit under the left hand while the right one is on the
 * numpad.
 */
export const PAYMENT_METHODS = [
  { value: "cash", label: "Tunai", shortcut: "A" },
  { value: "qris", label: "QRIS", shortcut: "Q" },
  { value: "debit", label: "Debit", shortcut: "Z" },
  { value: "ewallet", label: "E-Wallet", shortcut: "W" },
  { value: "transfer", label: "Transfer", shortcut: "S" },
] as const

export const QUICK_AMOUNT_OPTIONS = [5000, 10000, 20000, 50000, 100000] as const

export interface PaymentSplitForm {
  payment_method: string
  bank_name: string
  amount: number | null
  selected: boolean
}

function createInitialPaymentSplits(): PaymentSplitForm[] {
  return PAYMENT_METHODS.map((method) => ({
    payment_method: method.value,
    bank_name: "",
    amount: null,
    selected: method.value === "cash",
  }))
}

export interface UsePaymentFormArgs {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: TransactionResult) => void
}

/**
 * All the state and business rules behind the payment dialog: split
 * payments, the barcode-scanner guard on every amount field, and the
 * checkout call itself. `payment-dialog.tsx` only lays these out.
 */
export function usePaymentForm({ open, onOpenChange, onSuccess }: UsePaymentFormArgs) {
  const queryClient = useQueryClient()
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitForm[]>(createInitialPaymentSplits)
  const [requestedPaymentMethod, setActivePaymentMethod] = useState("cash")
  const [notes, setNotes] = useState("")
  const cashInputRef = useRef<HTMLInputElement>(null)
  const amountEntryRef = useRef(EMPTY_AMOUNT_ENTRY_TIMING)
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
  const selectedPaymentSplits = useMemo(
    () => paymentSplits.filter((split) => split.selected),
    [paymentSplits],
  )
  // Metode aktif harus selalu termasuk yang terpilih. Kalau tidak, "Uang Pas"
  // dan tombol nominal cepat akan mengisi metode yang tidak dicentang — QRIS
  // bisa tiba-tiba ikut ter-check. Diturunkan, bukan disinkronkan lewat efek,
  // supaya tidak pernah ada render dengan nilai yang sudah basi.
  const activePaymentMethod =
    selectedPaymentSplits.length > 0 &&
    !selectedPaymentSplits.some((split) => split.payment_method === requestedPaymentMethod)
      ? selectedPaymentSplits[0].payment_method
      : requestedPaymentMethod
  const selectedMethodCount = selectedPaymentSplits.length
  const isSingleCashSelection =
    selectedMethodCount === 1 && selectedPaymentSplits[0]?.payment_method === "cash"
  const primaryPaymentMethod = selectedPaymentSplits[0]?.payment_method ?? "cash"
  const primaryPaymentAmount = selectedPaymentSplits[0]?.amount ?? 0
  const changeAmount = isSingleCashSelection ? primaryPaymentAmount - total : 0
  const totalSplitAmount = useMemo(
    () => selectedPaymentSplits.reduce((sum, split) => sum + (split.amount ?? 0), 0),
    [selectedPaymentSplits],
  )
  const nonCashSplitAmount = useMemo(
    () =>
      selectedPaymentSplits
        .filter((split) => split.payment_method !== "cash")
        .reduce((sum, split) => sum + (split.amount ?? 0), 0),
    [selectedPaymentSplits],
  )
  const cashSplitAmount = useMemo(
    () =>
      selectedPaymentSplits
        .filter((split) => split.payment_method === "cash")
        .reduce((sum, split) => sum + (split.amount ?? 0), 0),
    [selectedPaymentSplits],
  )
  const splitDifference = total - totalSplitAmount
  const normalizedSplits: PaymentSplitInput[] = selectedPaymentSplits
    .filter((split) => split.payment_method && (split.amount ?? 0) > 0)
    .map((split) => ({
      payment_method: split.payment_method,
      bank_name: split.bank_name.trim() || undefined,
      amount: split.amount ?? 0,
    }))
  const splitMethods = normalizedSplits.map((split) => split.payment_method)
  const hasDuplicateSplitMethod = new Set(splitMethods).size !== splitMethods.length
  const hasCashInSplit = selectedPaymentSplits.some((split) => split.payment_method === "cash")
  const allSelectedMethodsHaveAmount = selectedPaymentSplits.every(
    (split) => (split.amount ?? 0) > 0,
  )
  const isSplitSelectionValid =
    normalizedSplits.length > 0 &&
    normalizedSplits.length === selectedPaymentSplits.length &&
    !hasDuplicateSplitMethod &&
    (hasCashInSplit
      ? nonCashSplitAmount <= total + 0.01 &&
        cashSplitAmount + 0.01 >= Math.max(total - nonCashSplitAmount, 0)
      : Math.abs(splitDifference) < 0.01)

  const isCashValid = !isSingleCashSelection || primaryPaymentAmount >= total
  // Barcode yang nyasar ke kolom nominal selalu jauh di atas batas ini.
  const hasImplausibleAmount = selectedPaymentSplits.some((split) =>
    isImplausiblePaymentAmount(split.amount ?? 0),
  )
  const canConfirm =
    items.length > 0 &&
    selectedMethodCount > 0 &&
    !hasImplausibleAmount &&
    (isSingleCashSelection ? isCashValid : allSelectedMethodsHaveAmount && isSplitSelectionValid) &&
    !checkoutTransaction.isPending

  // Auto-focus kolom nominal tunai saat dialog terbuka. React Aria sudah
  // memindah fokus ke dialog itu sendiri begitu ia terbuka; `setTimeout`
  // menjalankan fokus ini setelahnya, bukan sebelum, atau langsung tertimpa.
  useEffect(() => {
    if (open && isSingleCashSelection) {
      setTimeout(() => cashInputRef.current?.focus(), 100)
    }
  }, [isSingleCashSelection, open])

  const updateSplit = useCallback((method: string, next: Partial<PaymentSplitForm>) => {
    setPaymentSplits((current) =>
      current.map((split) => (split.payment_method === method ? { ...split, ...next } : split)),
    )
  }, [])

  const handleAmountChange = useCallback(
    (method: string, value: number | null) => {
      updateSplit(method, { amount: value, selected: true })
    },
    [updateSplit],
  )

  const handleBankNameChange = useCallback(
    (method: string, value: string) => {
      updateSplit(method, { bank_name: value, selected: true })
    },
    [updateSplit],
  )

  const handleQuickRoundAmount = useCallback(
    (amount: number) => {
      updateSplit(activePaymentMethod, { amount, selected: true })
    },
    [activePaymentMethod, updateSplit],
  )

  const handleSetRemainingAmount = useCallback(() => {
    const otherTotal = paymentSplits
      .filter((split) => split.payment_method !== activePaymentMethod && split.selected)
      .reduce((sum, split) => sum + (split.amount ?? 0), 0)

    const remaining = Math.max(total - otherTotal, 0)
    updateSplit(activePaymentMethod, { amount: remaining, selected: true })
  }, [activePaymentMethod, paymentSplits, total, updateSplit])

  // Pintasan ` (backtick) di mana saja di dialog: isi tunai persis senilai
  // total ("uang pas" tanpa menyentuh mouse), lalu fokuskan dan pilih isinya
  // supaya Enter berikutnya langsung membayar.
  useEffect(() => {
    if (!open || !isSingleCashSelection) return

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      if (event.key !== "`" && event.code !== "Backquote") {
        return
      }

      const target = event.target
      if (target instanceof HTMLTextAreaElement) {
        return
      }

      event.preventDefault()
      updateSplit("cash", { amount: total, selected: true })
      cashInputRef.current?.focus()
      cashInputRef.current?.select()
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [isSingleCashSelection, open, total, updateSplit])

  const handleMethodClick = useCallback(
    (method: string) => {
      const split = paymentSplits.find((current) => current.payment_method === method)
      if (!split) return

      // Metode sudah dipilih → klik lagi untuk melepas (klik di mana saja pada
      // tombol, bukan cuma di kotak centang). Kecuali ini satu-satunya metode
      // aktif: cukup jadikan aktif, jangan sampai tidak ada metode terpilih.
      if (split.selected) {
        if (selectedMethodCount <= 1) {
          setActivePaymentMethod(method)
          return
        }

        setPaymentSplits((current) =>
          current.map((currentSplit) =>
            currentSplit.payment_method === method
              ? { ...currentSplit, selected: false, amount: null, bank_name: "" }
              : currentSplit,
          ),
        )
        const fallback = paymentSplits.find(
          (current) => current.payment_method !== method && current.selected,
        )
        setActivePaymentMethod(fallback?.payment_method ?? "cash")
        return
      }

      // Belum dipilih. Selama pilihannya masih tunai tunggal → GANTI (radio).
      // Setelah itu, setiap metode baru → TAMBAH (multi payment).
      if (isSingleCashSelection && method !== "cash") {
        setPaymentSplits((current) =>
          current.map((currentSplit) =>
            currentSplit.payment_method === method
              ? { ...currentSplit, selected: true, amount: currentSplit.amount ?? total }
              : { ...currentSplit, selected: false, amount: null, bank_name: "" },
          ),
        )
        setActivePaymentMethod(method)
        return
      }

      setPaymentSplits((current) =>
        current.map((currentSplit) =>
          currentSplit.payment_method === method
            ? {
                ...currentSplit,
                selected: true,
                amount: method === "cash" ? null : currentSplit.amount,
              }
            : currentSplit,
        ),
      )
      setActivePaymentMethod(method)
    },
    [isSingleCashSelection, paymentSplits, selectedMethodCount, total],
  )

  // Alt+<letter> toggles a method exactly like a click on its button.
  useEffect(() => {
    if (!open) return

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      const method = PAYMENT_METHODS.find(
        (candidate) => candidate.shortcut === event.key.toUpperCase(),
      )
      if (!method) return

      event.preventDefault()
      handleMethodClick(method.value)
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [handleMethodClick, open])

  const recordAmountEntry = (at: number) => {
    amountEntryRef.current = trackAmountEntry(amountEntryRef.current, at)
  }

  const handleConfirm = useCallback(() => {
    if (!user) return

    const finalPaymentAmount = isSingleCashSelection ? primaryPaymentAmount : totalSplitAmount
    const finalPaymentMethod =
      selectedMethodCount > 1
        ? (normalizedSplits[0]?.payment_method ?? "cash")
        : primaryPaymentMethod

    checkoutTransaction.mutate(
      {
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
        payment_method: finalPaymentMethod,
        payment_amount: finalPaymentAmount,
        // A single cash sale is fully described by the two fields above; any
        // other single method may carry a bank/app name, which only the
        // breakdown has room for.
        payment_breakdown:
          selectedMethodCount > 1 || primaryPaymentMethod !== "cash" ? normalizedSplits : undefined,
        transaction_discount: getTransactionDiscountAmount() || undefined,
        shift_id: activeShift?.id,
        notes: notes.trim() || undefined,
      },
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
          queryClient.invalidateQueries({ queryKey: queryKeys.products.all, refetchType: "none" })
          queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
          onSuccess(result)
          setPaymentSplits(createInitialPaymentSplits())
          setNotes("")
        },
        onError: (err) => {
          toast.error(`Gagal memproses transaksi: ${err.message}`)
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user,
    isSingleCashSelection,
    primaryPaymentAmount,
    totalSplitAmount,
    selectedMethodCount,
    normalizedSplits,
    primaryPaymentMethod,
    items,
    notes,
    activeShift,
    checkoutTransaction,
    queryClient,
    onSuccess,
  ])

  // Scanner adalah keyboard: burst digit + Enter di kolom nominal tidak boleh
  // menutup transaksi. Waktu diambil dari `onKeyDown` (bukan `onChange` seperti
  // sebelum `RupiahField`): `TextField` HeroUI hanya meneruskan nilainya, bukan
  // event DOM-nya, jadi `event.timeStamp` per ketikan diambil di sini. Enter
  // yang datang dalam satu burst scan diabaikan dan nominalnya dikosongkan
  // supaya kasir tidak menagih angka barcode.
  const handleAmountKeyDown = useCallback(
    (method: string, currentAmount: number | null) => (event: KeyboardEvent<HTMLInputElement>) => {
      // `\` = Uang Pas: satu tuts di sebelah Enter, tanpa melepas tangan
      // dari deretan angka; di kolom nominal ia tidak punya arti lain.
      if (event.key === "\\") {
        event.preventDefault()
        handleSetRemainingAmount()
        return
      }
      if (event.key !== "Enter") {
        recordAmountEntry(event.timeStamp)
        return
      }

      event.preventDefault()

      const typedAmount = currentAmount != null ? String(currentAmount) : ""
      if (
        isScannerBurstEntry({
          amount: typedAmount,
          ...amountEntryRef.current,
          submittedAt: event.timeStamp,
        })
      ) {
        amountEntryRef.current = EMPTY_AMOUNT_ENTRY_TIMING
        updateSplit(method, { amount: null, selected: true })
        toast.warning(
          "Barcode terbaca di kolom nominal — scan diabaikan. Tutup dialog dulu untuk menambah barang.",
        )
        return
      }

      if (canConfirm) {
        handleConfirm()
      }
    },
    [canConfirm, handleConfirm, handleSetRemainingAmount, updateSplit],
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      amountEntryRef.current = EMPTY_AMOUNT_ENTRY_TIMING
      if (!isOpen) {
        setPaymentSplits(createInitialPaymentSplits())
        setActivePaymentMethod("cash")
        setNotes("")
      }
      onOpenChange(isOpen)
    },
    [onOpenChange],
  )

  return {
    // Totals
    total,
    subtotal,
    totalDiscount,
    // Splits
    paymentSplits,
    selectedPaymentSplits,
    activePaymentMethod,
    setActivePaymentMethod,
    selectedMethodCount,
    isSingleCashSelection,
    primaryPaymentAmount,
    changeAmount,
    totalSplitAmount,
    nonCashSplitAmount,
    cashSplitAmount,
    splitDifference,
    hasCashInSplit,
    hasImplausibleAmount,
    // Handlers
    cashInputRef,
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
    // Confirm
    canConfirm,
    isPending: checkoutTransaction.isPending,
  }
}
