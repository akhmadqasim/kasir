import { useState } from "react"
import { Button, Description, Input, Label, Modal, TextField } from "@heroui/react"
import { Percent } from "lucide-react"

import { id } from "@/i18n/id"
import { OptionSelect } from "@/components/option-select"
import { SummaryList } from "@/components/summary-list"
import { useCartStore } from "@/stores/cart-store"
import { DISCOUNT_TYPES, formatRupiah } from "../utils"

interface DiscountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function parseDiscount(raw: string, type: "fixed" | "percentage"): number {
  const num = Number(raw) || 0
  if (type === "percentage") return Math.min(Math.max(num, 0), 100)
  return Math.max(num, 0)
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

  const [txnDiscType, setTxnDiscType] = useState<"fixed" | "percentage">(
    transactionDiscount?.type ?? "fixed",
  )
  const [txnRaw, setTxnRaw] = useState(transactionDiscount ? String(transactionDiscount.value) : "")
  // Set when the last keystroke asked for more than 100%. The hint shows only
  // then: the Body already has its one sentence (DESIGN.md §5.7), and a
  // standing "Maksimal 100%" under the field would be a second one.
  const [wasClamped, setWasClamped] = useState(false)

  const { subtotal, itemDiscountsTotal, totalDiscount, total: finalTotal } = getCartTotals()
  // The store caps a fixed discount at what is left after the per-item ones.
  const discountBase = Math.max(subtotal - itemDiscountsTotal, 0)
  const isFixedOverBase = txnDiscType === "fixed" && Number(txnRaw || 0) > discountBase

  const handleTxnChange = (value: string) => {
    const digits = value.replace(/[^\d]/g, "")
    const parsed = parseDiscount(digits, txnDiscType)
    // A percentage above 100 is clamped by `parseDiscount`; the field shows the
    // clamped value too, so it never reads "150" while 100% is applied.
    const cleaned = txnDiscType === "percentage" && digits !== "" ? String(parsed) : digits
    setWasClamped(txnDiscType === "percentage" && Number(digits) > 100)
    setTxnRaw(cleaned)
    setTransactionDiscount(parsed > 0 ? { type: txnDiscType, value: parsed } : null)
  }

  const formatTxnDisplay = (raw: string): string => {
    if (!raw || txnDiscType === "percentage") return raw
    const num = Number(raw)
    if (isNaN(num) || num === 0) return raw
    return num.toLocaleString("id-ID")
  }

  const handleToggleType = (newType: "fixed" | "percentage") => {
    setTxnDiscType(newType)
    setTxnRaw("")
    setWasClamped(false)
    setTransactionDiscount(null)
  }

  const handleReset = () => {
    setTxnRaw("")
    setWasClamped(false)
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
                if (e.key === "Enter") onOpenChange(false)
              }}
            />
            {wasClamped ? (
              <Description className="text-warning">Maksimal 100%</Description>
            ) : isFixedOverBase ? (
              <Description className="text-warning">
                Melebihi belanja — dipotong jadi {formatRupiah(discountBase)}
              </Description>
            ) : null}
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
