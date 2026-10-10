import { useState } from "react"
import { Button, Description, Input, Label, Modal, TextField } from "@heroui/react"
import { Percent } from "lucide-react"

import { id } from "@/i18n/id"
import { OptionSelect } from "@/components/option-select"
import { SummaryList } from "@/components/summary-list"
import { useCartStore } from "@/stores/cart-store"
import { normalizeDiscount } from "@/stores/cart-totals"
import { useScanBurstGuard } from "@/hooks/use-scan-burst-guard"
import { DISCOUNT_TYPES, formatRupiah } from "../utils"

interface DiscountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DiscountDialog({ open, onOpenChange }: DiscountDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Diskon Total Transaksi">
          {/* React Aria melepas isi dialog saat ia menutup, jadi form-nya lahir
              ulang dari diskon yang tersimpan setiap kali dibuka. */}
          <DiscountDialogBody onOpenChange={onOpenChange} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function DiscountDialogBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const transactionDiscount = useCartStore((s) => s.transactionDiscount)
  const setTransactionDiscount = useCartStore((s) => s.setTransactionDiscount)
  const getCartTotals = useCartStore((s) => s.getCartTotals)

  const { subtotal, itemDiscountsTotal, totalDiscount, total: finalTotal } = getCartTotals()
  // A fixed discount is capped, when totals are computed, at what is left
  // after the per-item ones. The store keeps the typed amount whole.
  const discountBase = Math.max(subtotal - itemDiscountsTotal, 0)

  const [txnDiscType, setTxnDiscType] = useState<"fixed" | "percentage">(
    transactionDiscount?.type ?? "fixed",
  )
  // The field shows the discount as it applies: a fixed amount saved before
  // the cart shrank reads as the cut-down amount, not the one typed back then.
  const [txnRaw, setTxnRaw] = useState(() =>
    transactionDiscount
      ? String(normalizeDiscount(transactionDiscount, discountBase).entry?.value ?? 0)
      : "",
  )
  // Which limit the last value ran into, if any. The hint shows only then: the
  // Body already has its one sentence (DESIGN.md §5.7).
  const [clampedTo, setClampedTo] = useState<"percentage" | "fixed" | null>(() =>
    transactionDiscount && normalizeDiscount(transactionDiscount, discountBase).capped
      ? transactionDiscount.type
      : null,
  )

  // F2 focuses this field, so the next item scanned before the dialog is
  // closed types its barcode here: kept, it would be a discount as large as
  // the purchase. The field saves as it is typed, through `commit`, which
  // holds a typed digit's save until it cannot be a scan.
  const scanGuard = useScanBurstGuard({
    value: { raw: txnRaw, clampedTo },
    onRestore: (before) => {
      setTxnRaw(before.raw)
      setClampedTo(before.clampedTo)
    },
    message: id.cashier.scanIgnoredInField,
  })

  const handleTxnChange = (value: string) => {
    const digits = value.replace(/[^\d]/g, "")
    const typed = { type: txnDiscType, value: Number(digits) }
    // The field shows the limit it ran into: it never reads "150" while 100%
    // applies, nor 50.000 while 20.000 comes off. The store keeps a fixed
    // amount whole, so it applies in full once the cart grows into it.
    const { entry, capped } = normalizeDiscount(typed, discountBase)
    const shown = txnDiscType === "fixed" && !capped ? digits : String(entry?.value ?? 0)
    setClampedTo(capped ? txnDiscType : null)
    setTxnRaw(digits === "" ? "" : shown)
    scanGuard.commit(() => setTransactionDiscount(typed))
  }

  const formatTxnDisplay = (raw: string): string => {
    if (!raw || txnDiscType === "percentage") return raw
    const num = Number(raw)
    if (isNaN(num) || num === 0) return raw
    return num.toLocaleString("id-ID")
  }

  const handleToggleType = (newType: "fixed" | "percentage") => {
    scanGuard.cancel()
    setTxnDiscType(newType)
    setTxnRaw("")
    setClampedTo(null)
    setTransactionDiscount(null)
  }

  const handleReset = () => {
    scanGuard.cancel()
    setTxnRaw("")
    setClampedTo(null)
    setTransactionDiscount(null)
  }

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <Percent className="size-5" />
        </Modal.Icon>
        <Modal.Heading>Diskon Total Transaksi</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <p>{id.cashier.discountHint}</p>
        {/* Jenis dan nilai berdampingan dengan label terlihat masing-masing,
            sama seperti dialog ubah item — DESIGN.md §5.7. */}
        <div className="grid grid-cols-2 items-start gap-3">
          <OptionSelect
            label="Jenis diskon"
            variant="secondary"
            options={DISCOUNT_TYPES}
            value={txnDiscType}
            onChange={(key) => handleToggleType(key as "fixed" | "percentage")}
          />
          <TextField
            autoFocus
            fullWidth
            variant="secondary"
            value={formatTxnDisplay(txnRaw)}
            onChange={handleTxnChange}
          >
            <Label>{txnDiscType === "percentage" ? "Nilai diskon (%)" : "Nilai diskon"}</Label>
            <Input
              className="text-right tabular-nums"
              inputMode="numeric"
              placeholder="0"
              onKeyDown={(e) => {
                if (scanGuard.handleKeyDown(e)) return
                if (e.key === "Enter") onOpenChange(false)
              }}
            />
            {clampedTo && (
              <Description className="text-warning">
                {clampedTo === "percentage"
                  ? "Maksimal 100%"
                  : id.cashier.discountCapped(formatRupiah(discountBase))}
              </Description>
            )}
          </TextField>
        </div>

        <SummaryList
          items={[
            { label: "Subtotal", value: formatRupiah(subtotal) },
            ...(itemDiscountsTotal > 0
              ? [{ label: "Diskon Per Item", value: `-${formatRupiah(itemDiscountsTotal)}` }]
              : []),
            ...(totalDiscount > 0
              ? [
                  {
                    label: "Total Diskon",
                    value: `-${formatRupiah(totalDiscount)}`,
                    tone: "danger" as const,
                  },
                ]
              : []),
            { label: "Total Akhir", value: formatRupiah(finalTotal), tone: "strong" },
          ]}
        />
      </Modal.Body>

      <Modal.Footer>
        {transactionDiscount && (
          <Button variant="tertiary" onPress={handleReset}>
            Reset Diskon
          </Button>
        )}
        <Button slot="close">Selesai</Button>
      </Modal.Footer>
    </>
  )
}
