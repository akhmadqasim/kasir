import { useState } from "react"
import { Button, Input, Modal, TextField } from "@heroui/react"

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
  const getSubtotal = useCartStore((s) => s.getSubtotal)
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount)
  const getTotal = useCartStore((s) => s.getTotal)
  const getItemDiscountsTotal = useCartStore((s) => s.getItemDiscountsTotal)

  const [txnDiscType, setTxnDiscType] = useState<"fixed" | "percentage">(
    transactionDiscount?.type ?? "fixed",
  )
  const [txnRaw, setTxnRaw] = useState(transactionDiscount ? String(transactionDiscount.value) : "")

  const subtotal = getSubtotal()
  const itemDiscountsTotal = getItemDiscountsTotal()
  const totalDiscount = getTotalDiscount()
  const finalTotal = getTotal()

  const handleTxnChange = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, "")
    setTxnRaw(cleaned)
    const parsed = parseDiscount(cleaned, txnDiscType)
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
    setTransactionDiscount(null)
  }

  const handleReset = () => {
    setTxnRaw("")
    setTransactionDiscount(null)
  }

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>Diskon Total Transaksi</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        {/* Jenis dan nilai berdampingan; judul bloknya ditulis sekali, kolomnya
            sendiri diberi `aria-label` supaya tidak ada `<label>` menggantung. */}
        <div className="flex flex-col gap-2">
          <p className="font-medium text-foreground">Diskon</p>
          <div className="flex items-center gap-2">
            <OptionSelect
              aria-label="Jenis diskon"
              variant="secondary"
              options={DISCOUNT_TYPES}
              value={txnDiscType}
              onChange={(key) => handleToggleType(key as "fixed" | "percentage")}
            />
            <TextField
              aria-label="Nilai diskon"
              autoFocus
              className="flex-1"
              variant="secondary"
              value={formatTxnDisplay(txnRaw)}
              onChange={handleTxnChange}
            >
              <Input
                className="text-right tabular-nums"
                inputMode="numeric"
                placeholder={txnDiscType === "percentage" ? "Persentase (%)" : "Nominal (Rp)"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenChange(false)
                }}
              />
            </TextField>
          </div>
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
            Reset
          </Button>
        )}
        <Button slot="close">Selesai</Button>
      </Modal.Footer>
    </>
  )
}
