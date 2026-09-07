import { useState } from "react"
import { Button, Input, Label, ListBox, Modal, Select, Separator, TextField } from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { useCartStore } from "../hooks/use-cart-store"
import { formatRupiah } from "../utils"

const DISCOUNT_TYPES = [
  { key: "fixed", label: "Nominal (Rp)" },
  { key: "percentage", label: "Persen (%)" },
] as const

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
      <Modal.Header>
        <Modal.Heading>Diskon Total Transaksi</Modal.Heading>
        <Modal.CloseTrigger />
      </Modal.Header>

      <Modal.Body className="space-y-4">
        {/* Transaction-level discount */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Diskon</p>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Jenis diskon"
              className="w-[130px]"
              value={txnDiscType}
              onChange={(value) => handleToggleType(value as "fixed" | "percentage")}
            >
              <Select.Trigger>
                <Select.Value>{selectedText}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {DISCOUNT_TYPES.map((option) => (
                    <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                      <Label>{option.label}</Label>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <TextField
              aria-label="Nilai diskon"
              autoFocus
              className="flex-1"
              value={formatTxnDisplay(txnRaw)}
              onChange={handleTxnChange}
            >
              <Input
                className="h-9 text-right tabular-nums"
                inputMode="numeric"
                placeholder={txnDiscType === "percentage" ? "Persentase (%)" : "Nominal (Rp)"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenChange(false)
                }}
              />
            </TextField>
          </div>
        </div>

        <Separator />

        {/* Summary */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span className="tabular-nums">{formatRupiah(subtotal)}</span>
          </div>
          {itemDiscountsTotal > 0 && (
            <div className="flex justify-between text-muted">
              <span>Diskon Per Item</span>
              <span className="tabular-nums">-{formatRupiah(itemDiscountsTotal)}</span>
            </div>
          )}
          {totalDiscount > 0 && (
            <div className="flex justify-between text-danger">
              <span>Total Diskon</span>
              <span className="tabular-nums">-{formatRupiah(totalDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>Total Akhir</span>
            <span className="tabular-nums">{formatRupiah(finalTotal)}</span>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {transactionDiscount && (
          <Button variant="tertiary" onPress={handleReset}>
            Reset
          </Button>
        )}
        <Button onPress={() => onOpenChange(false)}>Selesai</Button>
      </Modal.Footer>
    </>
  )
}
