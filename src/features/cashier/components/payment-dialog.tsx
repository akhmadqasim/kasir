import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Delete, RotateCcw } from "lucide-react"
import { toast } from "@/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField,
  ToggleButton,
} from "@heroui/react"
import { InfoPanel } from "@/components/info-panel"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { selectedText } from "@/components/selected-text"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { useCheckoutTransaction } from "../hooks/use-cashier"
import { cn } from "@/lib/utils"
import {
  EMPTY_AMOUNT_ENTRY_TIMING,
  MAX_PAYMENT_AMOUNT,
  isImplausiblePaymentAmount,
  isScannerBurstEntry,
  trackAmountEntry,
} from "../payment-behavior"
import { formatRupiah } from "../utils"
import type { PaymentSplitInput, TransactionResult } from "../types"

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: TransactionResult) => void
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "debit", label: "Debit" },
  { value: "ewallet", label: "E-Wallet" },
  { value: "transfer", label: "Transfer Bank" },
] as const

const BANK_OPTIONS = [
  "BCA",
  "BRI",
  "BNI",
  "Mandiri",
  "BTN",
  "CIMB Niaga",
  "Permata",
  "Danamon",
  "BSI",
  "SeaBank",
  "Jago",
  "Neo Bank",
] as const

interface PaymentSplitForm {
  payment_method: string
  bank_name: string
  amount: string
  selected: boolean
}

function createInitialPaymentSplits(): PaymentSplitForm[] {
  return PAYMENT_METHODS.map((method) => ({
    payment_method: method.value,
    bank_name: "",
    amount: "",
    selected: method.value === "cash",
  }))
}

export function PaymentDialog({ open, onOpenChange, onSuccess }: PaymentDialogProps) {
  const queryClient = useQueryClient()
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitForm[]>(createInitialPaymentSplits)
  const [requestedPaymentMethod, setActivePaymentMethod] = useState("cash")
  const [notes, setNotes] = useState("")
  const paymentInputRef = useRef<HTMLInputElement>(null)
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
  // Metode aktif harus selalu termasuk yang terpilih. Kalau tidak, "Uang Pas" dan
  // keypad akan mengisi metode yang tidak dicentang — QRIS bisa tiba-tiba ikut
  // ter-check. Diturunkan, bukan disinkronkan lewat efek, supaya tidak pernah ada
  // render dengan nilai yang sudah basi.
  const activePaymentMethod =
    selectedPaymentSplits.length > 0 &&
    !selectedPaymentSplits.some((split) => split.payment_method === requestedPaymentMethod)
      ? selectedPaymentSplits[0].payment_method
      : requestedPaymentMethod
  const activeSplit =
    paymentSplits.find((split) => split.payment_method === activePaymentMethod) ?? paymentSplits[0]
  const selectedMethodCount = selectedPaymentSplits.length
  const selectedTransferSplits = selectedPaymentSplits.filter(
    (split) => split.payment_method === "transfer",
  )
  const isSingleCashSelection =
    selectedMethodCount === 1 && selectedPaymentSplits[0]?.payment_method === "cash"
  const primaryPaymentMethod = selectedPaymentSplits[0]?.payment_method ?? "cash"
  const primaryPaymentAmount = Number(selectedPaymentSplits[0]?.amount) || 0
  const changeAmount = isSingleCashSelection ? primaryPaymentAmount - total : 0
  const totalSplitAmount = useMemo(
    () => selectedPaymentSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0),
    [selectedPaymentSplits],
  )
  const nonCashSplitAmount = useMemo(
    () =>
      selectedPaymentSplits
        .filter((split) => split.payment_method !== "cash")
        .reduce((sum, split) => sum + (Number(split.amount) || 0), 0),
    [selectedPaymentSplits],
  )
  const cashSplitAmount = useMemo(
    () =>
      selectedPaymentSplits
        .filter((split) => split.payment_method === "cash")
        .reduce((sum, split) => sum + (Number(split.amount) || 0), 0),
    [selectedPaymentSplits],
  )
  const splitDifference = total - totalSplitAmount
  const normalizedSplits: PaymentSplitInput[] = selectedPaymentSplits
    .filter((split) => split.payment_method && (Number(split.amount) || 0) > 0)
    .map((split) => ({
      payment_method: split.payment_method,
      bank_name:
        split.payment_method === "transfer" ? split.bank_name.trim() || undefined : undefined,
      amount: Number(split.amount) || 0,
    }))
  const splitMethods = normalizedSplits.map((split) => split.payment_method)
  const hasDuplicateSplitMethod = new Set(splitMethods).size !== splitMethods.length
  const hasCashInSplit = selectedPaymentSplits.some((split) => split.payment_method === "cash")
  const allSelectedMethodsHaveAmount = selectedPaymentSplits.every(
    (split) => (Number(split.amount) || 0) > 0,
  )
  const allTransferMethodsHaveBank = selectedTransferSplits.every(
    (split) => split.bank_name.trim().length > 0,
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
    isImplausiblePaymentAmount(Number(split.amount) || 0),
  )
  const canConfirm =
    items.length > 0 &&
    selectedMethodCount > 0 &&
    allTransferMethodsHaveBank &&
    !hasImplausibleAmount &&
    (isSingleCashSelection ? isCashValid : allSelectedMethodsHaveAmount && isSplitSelectionValid) &&
    !checkoutTransaction.isPending

  const quickAmounts = QUICK_AMOUNT_OPTIONS

  // Auto-focus payment input when dialog opens
  useEffect(() => {
    if (open && isSingleCashSelection) {
      setTimeout(() => paymentInputRef.current?.focus(), 100)
    }
  }, [isSingleCashSelection, open])

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat("id-ID").format(num)
  }

  const formatAmountDisplay = (raw: string): string => (raw ? formatNumber(Number(raw) || 0) : "")

  const sanitizeAmount = (raw: string): string => raw.replace(/^0+(?=\d)/, "")

  const updateSplit = useCallback((method: string, next: Partial<PaymentSplitForm>) => {
    setPaymentSplits((current) =>
      current.map((split) => (split.payment_method === method ? { ...split, ...next } : split)),
    )
  }, [])

  const handleAmountChange = useCallback(
    (method: string, value: string) => {
      updateSplit(method, {
        amount: sanitizeAmount(value.replace(/\D/g, "")),
        selected: true,
      })
    },
    [updateSplit],
  )

  const handleBankNameChange = useCallback(
    (method: string, value: string) => {
      updateSplit(method, {
        bank_name: value,
        selected: true,
      })
    },
    [updateSplit],
  )

  const handleQuickAmount = useCallback(
    (amount: number) => {
      updateSplit("cash", { amount: String(amount), selected: true })
    },
    [updateSplit],
  )

  useEffect(() => {
    if (!open || !isSingleCashSelection) return

    const handleShortcut = (event: KeyboardEvent) => {
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
      handleQuickAmount(total)
      paymentInputRef.current?.focus()
      paymentInputRef.current?.select()
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [handleQuickAmount, isSingleCashSelection, open, total])

  const handleMethodToggle = useCallback((method: string, checked: boolean) => {
    setPaymentSplits((current) =>
      current.map((split) => {
        if (split.payment_method !== method) return split

        if (!checked) {
          return { ...split, selected: false, amount: "", bank_name: "" }
        }

        return {
          ...split,
          selected: true,
          amount: split.amount,
        }
      }),
    )
  }, [])

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
              ? { ...currentSplit, selected: false, amount: "", bank_name: "" }
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
              ? {
                  ...currentSplit,
                  selected: true,
                  amount: currentSplit.amount || String(total),
                }
              : { ...currentSplit, selected: false, amount: "", bank_name: "" },
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
                amount: method === "cash" ? "0" : currentSplit.amount,
              }
            : currentSplit,
        ),
      )
      setActivePaymentMethod(method)
    },
    [isSingleCashSelection, paymentSplits, selectedMethodCount, total],
  )

  const ensureActiveMethodSelected = useCallback(() => {
    if (activeSplit?.selected) return
    handleMethodToggle(activePaymentMethod, true)
  }, [activePaymentMethod, activeSplit?.selected, handleMethodToggle])

  const handleKeypadInput = useCallback(
    (key: string) => {
      ensureActiveMethodSelected()

      const currentAmount = activeSplit?.amount ?? ""
      const nextAmount = sanitizeAmount(`${currentAmount}${key}`)
      updateSplit(activePaymentMethod, {
        amount: nextAmount,
        selected: true,
      })
    },
    [activePaymentMethod, activeSplit?.amount, ensureActiveMethodSelected, updateSplit],
  )

  const handleKeypadDelete = useCallback(() => {
    if (!activeSplit) return

    updateSplit(activePaymentMethod, {
      amount: activeSplit.amount.slice(0, -1),
      selected: true,
    })
  }, [activePaymentMethod, activeSplit, updateSplit])

  const handleKeypadClear = useCallback(() => {
    if (!activeSplit) return

    updateSplit(activePaymentMethod, {
      amount: "",
      selected: activeSplit.selected,
    })
  }, [activePaymentMethod, activeSplit, updateSplit])

  const handleSetExactAmount = useCallback(
    (amount: number) => {
      ensureActiveMethodSelected()
      updateSplit(activePaymentMethod, {
        amount: String(amount),
        selected: true,
      })
    },
    [activePaymentMethod, ensureActiveMethodSelected, updateSplit],
  )

  const handleSetRemainingAmount = useCallback(() => {
    ensureActiveMethodSelected()

    const otherTotal = paymentSplits
      .filter((split) => split.payment_method !== activePaymentMethod && split.selected)
      .reduce((sum, split) => sum + (Number(split.amount) || 0), 0)

    const remaining = Math.max(total - otherTotal, 0)
    updateSplit(activePaymentMethod, {
      amount: String(remaining),
      selected: true,
    })
  }, [activePaymentMethod, ensureActiveMethodSelected, paymentSplits, total, updateSplit])

  const recordAmountEntry = (at: number) => {
    amountEntryRef.current = trackAmountEntry(amountEntryRef.current, at)
  }

  // Scanner adalah keyboard: burst digit + Enter di kolom nominal tidak boleh
  // menutup transaksi. Enter yang datang dalam satu burst scan diabaikan dan
  // nominalnya dikosongkan supaya kasir tidak menagih angka barcode.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, method: string) => {
    if (e.key !== "Enter") return
    e.preventDefault()

    const typedAmount = e.currentTarget.value.replace(/\D/g, "")
    if (
      isScannerBurstEntry({
        amount: typedAmount,
        ...amountEntryRef.current,
        submittedAt: e.timeStamp,
      })
    ) {
      amountEntryRef.current = EMPTY_AMOUNT_ENTRY_TIMING
      updateSplit(method, { amount: "", selected: true })
      toast.warning(
        "Barcode terbaca di kolom nominal — scan diabaikan. Tutup dialog dulu untuk menambah barang.",
      )
      return
    }

    if (canConfirm) {
      handleConfirm()
    }
  }

  const handleConfirm = () => {
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
        payment_breakdown:
          selectedMethodCount > 1
            ? normalizedSplits
            : primaryPaymentMethod === "transfer"
              ? normalizedSplits
              : undefined,
        transaction_discount: getTransactionDiscountAmount() || undefined,
        shift_id: activeShift?.id,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          // A sale moves stock, the transaction list, the shift's drawer and
          // every dashboard panel. The keys are prefixes, so one call each
          // covers the whole resource.
          queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
          queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
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
  }

  const handleOpenChange = (isOpen: boolean) => {
    amountEntryRef.current = EMPTY_AMOUNT_ENTRY_TIMING
    if (!isOpen) {
      setPaymentSplits(createInitialPaymentSplits())
      setActivePaymentMethod("cash")
      setNotes("")
    }
    onOpenChange(isOpen)
  }

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={handleOpenChange}>
      <Modal.Container size="lg">
        {/* Dua panel berdampingan (nominal + catatan di kiri, keypad + metode di
            kanan) butuh ~52rem; skala `size` berhenti di `lg` (32rem), jadi lebarnya
            diberi lewat className Dialog seperti pola dokumentasi (`sm:max-w-…`).
            Tingginya sudah dibatasi `scroll="inside"` bawaan Container. */}
        <Modal.Dialog aria-label="Pembayaran" className="sm:max-w-[52rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Pembayaran</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(280px,0.72fr)]">
              <div className="min-h-0 overflow-y-auto">
                <InfoPanel className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-muted">Total Transaksi</p>
                    {totalDiscount > 0 && (
                      <p className="text-muted">Diskon: {formatRupiah(totalDiscount)}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {/* Peran "Total keranjang" — DESIGN.md §3.4 */}
                    <p className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                      {formatRupiah(total)}
                    </p>
                    {subtotal !== total && (
                      <p className="text-muted">Subtotal {formatRupiah(subtotal)}</p>
                    )}
                  </div>
                </InfoPanel>

                <div className="mt-3.5 space-y-2.5">
                  {selectedPaymentSplits.length > 0 ? (
                    selectedPaymentSplits.map((split) => {
                      const amountInputId = `payment-amount-${split.payment_method}`
                      const label =
                        PAYMENT_METHODS.find((method) => method.value === split.payment_method)
                          ?.label ?? split.payment_method

                      return (
                        <div
                          key={split.payment_method}
                          className={cn(
                            "grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2 rounded-xl border bg-surface p-2.5 sm:grid-cols-[120px_minmax(0,1fr)]",
                            activePaymentMethod === split.payment_method &&
                              "border-accent ring-2 ring-accent/20",
                          )}
                        >
                          <div className="text-xs text-muted">{label}</div>
                          {/* `Input` telanjang, bukan `TextField`: penjaga scan membaca
                          `event.timeStamp` dari event perubahan dan Enter, dan
                          `TextField` hanya meneruskan nilainya. */}
                          <Input
                            ref={split.payment_method === "cash" ? paymentInputRef : undefined}
                            aria-label={`Nominal ${label}`}
                            id={amountInputId}
                            type="text"
                            inputMode="numeric"
                            fullWidth
                            variant="secondary"
                            className="text-right tabular-nums"
                            placeholder="0"
                            value={formatAmountDisplay(split.amount)}
                            onClick={() => {
                              setActivePaymentMethod(split.payment_method)
                            }}
                            onChange={(event) => {
                              recordAmountEntry(event.timeStamp)
                              handleAmountChange(split.payment_method, event.target.value)
                            }}
                            onKeyDown={(event) => handleKeyDown(event, split.payment_method)}
                          />
                          {split.payment_method === "transfer" && (
                            <div className="col-span-2 sm:col-start-2 sm:col-span-1">
                              <Select
                                fullWidth
                                variant="secondary"
                                placeholder="Pilih bank"
                                value={split.bank_name || null}
                                onChange={(value) =>
                                  handleBankNameChange(
                                    split.payment_method,
                                    value === null ? "" : String(value),
                                  )
                                }
                                onOpenChange={(isOpen) => {
                                  if (isOpen) {
                                    setActivePaymentMethod(split.payment_method)
                                  }
                                }}
                              >
                                <Label>Bank</Label>
                                <Select.Trigger>
                                  <Select.Value>{selectedText}</Select.Value>
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    {BANK_OPTIONS.map((bank) => (
                                      <ListBox.Item key={bank} id={bank} textValue={bank}>
                                        <Label>{bank}</Label>
                                        <ListBox.ItemIndicator />
                                      </ListBox.Item>
                                    ))}
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </div>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <NoData title="Pilih metode pembayaran di panel kanan untuk mulai mengisi nominal." />
                  )}
                </div>

                <div className="mt-3.5 space-y-2.5">
                  <TextField fullWidth value={notes} variant="secondary" onChange={setNotes}>
                    <Label>Catatan</Label>
                    <TextArea placeholder="Tambahkan catatan untuk transaksi ini..." rows={2} />
                  </TextField>
                  {isSingleCashSelection && primaryPaymentAmount > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted">Kembalian</span>
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          changeAmount < 0 ? "text-danger" : "text-success",
                        )}
                      >
                        {formatRupiah(Math.max(0, changeAmount))}
                      </span>
                    </div>
                  )}
                  {hasImplausibleAmount && (
                    <p className="text-sm font-medium text-danger">
                      Nominal pembayaran melebihi {formatRupiah(MAX_PAYMENT_AMOUNT)}. Periksa
                      kembali — kemungkinan barcode ikut terbaca.
                    </p>
                  )}
                  {selectedMethodCount > 1 &&
                    ((!hasCashInSplit && Math.abs(splitDifference) >= 0.01) ||
                      (hasCashInSplit &&
                        (nonCashSplitAmount > total + 0.01 ||
                          cashSplitAmount + 0.01 < Math.max(total - nonCashSplitAmount, 0)))) && (
                      <p className="text-sm font-medium text-danger">
                        {hasCashInSplit
                          ? nonCashSplitAmount > total + 0.01
                            ? "Nominal non-tunai melebihi total transaksi."
                            : `Nominal tunai masih kurang ${formatRupiah(
                                Math.max(total - nonCashSplitAmount - cashSplitAmount, 0),
                              )}.`
                          : splitDifference > 0
                            ? `Nominal gabungan masih kurang ${formatRupiah(splitDifference)}.`
                            : `Nominal gabungan kelebihan ${formatRupiah(Math.abs(splitDifference))}.`}
                      </p>
                    )}
                  {selectedMethodCount > 1 &&
                    hasCashInSplit &&
                    nonCashSplitAmount <= total + 0.01 &&
                    cashSplitAmount + 0.01 >= Math.max(total - nonCashSplitAmount, 0) &&
                    totalSplitAmount - total > 0.01 && (
                      <p className="text-sm font-medium text-success">
                        Kembalian tunai: {formatRupiah(totalSplitAmount - total)}
                      </p>
                    )}
                  {!allTransferMethodsHaveBank && (
                    <p className="text-sm font-medium text-danger">
                      Isi nama bank untuk pembayaran transfer bank.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-col gap-2 sm:gap-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2 sm:grid-cols-[minmax(0,1fr)_96px]">
                  <div className="grid grid-cols-3 gap-2">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "000"].map((key) => (
                      <Button
                        key={key}
                        variant="secondary"
                        className="h-9 text-base font-medium tabular-nums sm:h-9.5 sm:text-[1rem]"
                        onPress={() => handleKeypadInput(key)}
                      >
                        {key}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-rows-2 gap-2">
                    <Button
                      variant="tertiary"
                      className="h-full min-h-[68px] text-sm font-medium sm:min-h-[74px] sm:text-sm"
                      onPress={handleKeypadDelete}
                    >
                      <Delete />
                      Delete
                    </Button>
                    <Button
                      variant="tertiary"
                      className="h-full min-h-[68px] text-sm font-medium sm:min-h-[74px] sm:text-sm"
                      onPress={handleKeypadClear}
                    >
                      <RotateCcw />
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {quickAmounts.map((amount) => (
                    <Button
                      key={amount}
                      variant="secondary"
                      className="h-8 text-xs font-medium tabular-nums sm:h-8.5 sm:text-xs"
                      onPress={() => handleSetExactAmount(amount)}
                    >
                      {formatQuickAmountLabel(amount)}
                    </Button>
                  ))}
                </div>

                <Button
                  fullWidth
                  variant="secondary"
                  className="h-9 text-base font-semibold sm:h-9.5 sm:text-lg"
                  onPress={handleSetRemainingAmount}
                >
                  Uang Pas
                </Button>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <p className="mb-3 text-xs text-muted">Metode Pembayaran</p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {PAYMENT_METHODS.map((method) => {
                      const split = paymentSplits.find(
                        (current) => current.payment_method === method.value,
                      )

                      if (!split) return null

                      const isSelected = split.selected
                      const isActive = activePaymentMethod === method.value

                      return (
                        // `ToggleButton`, bukan tombol biasa: metode yang tercentang
                        // adalah keadaan, dan `aria-pressed` satu-satunya cara pembaca
                        // layar tahu mana yang aktif. Klik tetap lewat
                        // `handleMethodClick` — aturan radio-lalu-tambah ada di sana.
                        <ToggleButton
                          key={method.value}
                          className={cn(
                            "h-9 justify-start gap-2.5 px-3 text-left text-sm font-medium",
                            isSelected && "border-accent bg-accent/10 text-accent",
                            isActive && "ring-2 ring-accent/20",
                          )}
                          isSelected={isSelected}
                          onChange={() => handleMethodClick(method.value)}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "pointer-events-none flex h-5 w-5 items-center justify-center rounded border",
                              isSelected
                                ? "border-accent bg-accent text-accent-foreground"
                                : "border-muted/30",
                            )}
                          >
                            {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                          </span>
                          <span className="flex-1">{method.label}</span>
                        </ToggleButton>
                      )
                    })}
                  </div>
                </div>

                <PendingButton
                  className="sticky bottom-0 shrink-0"
                  fullWidth
                  isDisabled={!canConfirm}
                  isPending={checkoutTransaction.isPending}
                  size="lg"
                  onPress={handleConfirm}
                >
                  Bayar
                </PendingButton>
              </div>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

const QUICK_AMOUNT_OPTIONS = [5000, 10000, 20000, 50000, 100000] as const

function formatQuickAmountLabel(amount: number): string {
  if (amount >= 1000 && amount % 1000 === 0) {
    return `${amount / 1000}k`
  }

  return formatRupiah(amount).replace("Rp", "").trim()
}
