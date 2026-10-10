import { useEffect, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent } from "react"
import { Button, Description, Form, Label, Modal, NumberField } from "@heroui/react"

import { id } from "@/i18n/id"
import { OptionSelect } from "@/components/option-select"
import { RupiahField } from "@/components/rupiah-field"
import { SummaryList } from "@/components/summary-list"
import { isEmptyNumberFieldValue } from "@/lib/number-field"
import { MAX_CART_QUANTITY, useCartStore } from "@/stores/cart-store"
import { discountAmount, normalizeDiscount } from "@/stores/cart-totals"
import { useScanBurstGuard } from "@/hooks/use-scan-burst-guard"
import type { CartItem } from "../types"
import { DISCOUNT_TYPES, formatRupiah, getQuantityWarning, isPpobBelowCost } from "../utils"

interface CartItemEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: CartItem | null
}

/**
 * Enter di kolom manapun mengirim form lewat `requestSubmit`, alih-alih
 * mengandalkan submit-implisit bawaan browser saat Enter ditekan di kolom
 * teks. Tidak menyentuh state komponen sama sekali — `requestSubmit`
 * men-dispatch event `submit` baru ke elemen `<form>`, dan React membaca
 * closure `onSubmit` terbaru untuk event itu, bukan closure yang sudah
 * dipasang saat `keydown` ini dimulai. Itu penting khusus untuk `NumberField`:
 * ia meng-commit angka yang diketik pada `keydown`-nya sendiri lebih dulu,
 * jadi kalau di sini kita membaca state secara langsung (bukan lewat submit
 * baru), yang terbaca adalah nilai sebelum commit itu selesai.
 */
function submitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.form?.requestSubmit()
}

export function CartItemEditDialog({ open, onOpenChange, item }: CartItemEditDialogProps) {
  if (!item) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={item.product_name}>
          <Modal.CloseTrigger />
          {/* Body hanya hidup selama dialog terbuka dan di-key per baris keranjang,
              jadi state form-nya lahir dari item yang benar tanpa perlu efek
              penyelaras yang bisa menimpa ketikan kasir. */}
          <CartItemEditBody key={item.cart_id} item={item} onOpenChange={onOpenChange} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function CartItemEditBody({
  item,
  onOpenChange,
}: {
  item: CartItem
  onOpenChange: (open: boolean) => void
}) {
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const setItemDiscount = useCartStore((s) => s.setItemDiscount)
  const itemDiscounts = useCartStore((s) => s.itemDiscounts)

  const disc = itemDiscounts[item.cart_id]
  const savedLineTotal = item.product_price * item.quantity
  // Jumlah valid terakhir — dipakai untuk total dan peringatan. Batasnya
  // (1..MAX_CART_QUANTITY, kelipatan 1) sudah dijaga oleh `minValue`/`maxValue`/
  // `step` pada `NumberField` di bawah; state ini cuma menyaring nilai
  // kosong/NaN yang muncul saat kolomnya sedang dikosongkan.
  const [qty, setQty] = useState(item.quantity)
  const [discType, setDiscType] = useState<"fixed" | "percentage">(disc?.type ?? "fixed")
  // A fixed amount is shown as it applies, never above the line's total, and
  // flagged when it was cut down to it. Only the store clamps what is saved.
  const [discValue, setDiscValue] = useState<number | null>(() =>
    disc ? (normalizeDiscount(disc, savedLineTotal).entry?.value ?? 0) : null,
  )
  const [discCapped, setDiscCapped] = useState(
    () => disc?.type === "fixed" && normalizeDiscount(disc, savedLineTotal).capped,
  )
  const qtyInputRef = useRef<HTMLInputElement>(null)

  const lineTotal = item.product_price * qty
  const quantityWarning = getQuantityWarning(item, qty)
  const rawDisc = discValue ?? 0
  const appliedDisc = normalizeDiscount({ type: discType, value: rawDisc }, lineTotal).entry
  const discAmount = appliedDisc ? discountAmount(lineTotal, appliedDisc) : 0
  const finalTotal = Math.max(0, lineTotal - discAmount)
  const belowCost = isPpobBelowCost(item, finalTotal)

  /** Keeps a fixed discount within `total`, and flags it when it had to be cut. */
  const applyFixedDiscount = (value: number | null, total: number) => {
    const { entry, capped } = normalizeDiscount({ type: "fixed", value: value ?? 0 }, total)
    setDiscValue(capped ? (entry?.value ?? 0) : value)
    setDiscCapped(capped)
  }

  const handleQtyChange = (value: number | undefined) => {
    if (isEmptyNumberFieldValue(value)) return
    setQty(value)
    // A lower quantity shrinks the line under a fixed discount set for more.
    if (discType === "fixed" && discValue != null && discValue > item.product_price * value) {
      applyFixedDiscount(discValue, item.product_price * value)
    }
  }

  // A barcode scanned into the quantity would be clamped to MAX_CART_QUANTITY
  // and saved by its Enter; into a discount, cut down to the whole line.
  const qtyScanGuard = useScanBurstGuard({
    value: qty,
    onRestore: setQty,
    message: id.cashier.scanIgnoredInField,
  })
  const handleQtyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (qtyScanGuard.handleKeyDown(e)) return
    submitOnEnter(e)
  }

  const discountScanGuard = useScanBurstGuard({
    value: { discValue, discCapped },
    onRestore: (before) => {
      setDiscValue(before.discValue)
      setDiscCapped(before.discCapped)
    },
    message: id.cashier.scanIgnoredInField,
  })
  const handleDiscountKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (discountScanGuard.handleKeyDown(e)) return
    submitOnEnter(e)
  }

  const handleTypeChange = (newType: "fixed" | "percentage") => {
    setDiscType(newType)
    setDiscValue(null)
    setDiscCapped(false)
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // The server refuses a PPOB line below cost; the hint says why.
    if (belowCost) return

    if (!item.is_ppob) {
      updateQuantity(item.cart_id, qty)
    }

    // Clamped by `setItemDiscount` (a percentage to 100, a fixed amount to the
    // line total), against the quantity saved just above.
    setItemDiscount(item.cart_id, { type: discType, value: rawDisc })

    onOpenChange(false)
  }

  const handleReset = () => {
    setDiscType("fixed")
    setDiscValue(null)
    setDiscCapped(false)
    setItemDiscount(item.cart_id, null)
  }

  // Baris PPOB tidak punya jumlah yang bisa diubah, jadi tidak ada yang difokuskan.
  // React Aria memindahkan fokus ke dalam dialog saat ia dipasang, jadi seleksinya
  // dijadwalkan setelah langkah itu selesai — kalau tidak, teksnya dipilih lalu
  // fokusnya langsung diambil kembali.
  useEffect(() => {
    if (item.is_ppob) return

    const timer = setTimeout(() => {
      qtyInputRef.current?.focus()
      qtyInputRef.current?.select()
    }, 50)

    return () => clearTimeout(timer)
  }, [item.is_ppob])

  return (
    <Form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <Modal.Header>
        <Modal.Heading>{item.product_name}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <p className="tabular-nums">
          Harga {formatRupiah(item.product_price)} / {item.unit ?? "pcs"}
        </p>

        {!item.is_ppob && (
          <NumberField
            fullWidth
            maxValue={MAX_CART_QUANTITY}
            minValue={1}
            step={1}
            value={qty}
            variant="secondary"
            onChange={handleQtyChange}
          >
            <Label>Jumlah</Label>
            <NumberField.Group>
              <NumberField.DecrementButton aria-label="Kurangi jumlah" />
              <NumberField.Input
                ref={qtyInputRef}
                className="text-center tabular-nums"
                onKeyDown={handleQtyKeyDown}
              />
              <NumberField.IncrementButton aria-label="Tambah jumlah" />
            </NumberField.Group>
            {quantityWarning && (
              <Description className="text-warning">{quantityWarning}</Description>
            )}
          </NumberField>
        )}

        {/* Jenis dan nilai diskon berdampingan, seperti dialog diskon transaksi. */}
        <div className="grid grid-cols-2 gap-3">
          <OptionSelect
            label="Jenis diskon"
            options={DISCOUNT_TYPES}
            value={discType}
            variant="secondary"
            onChange={(key) => handleTypeChange(key as "fixed" | "percentage")}
          />

          {discType === "fixed" ? (
            <RupiahField
              label="Nilai diskon"
              placeholder="0"
              value={discValue}
              warning={discCapped ? id.cashier.discountCapped(formatRupiah(lineTotal)) : undefined}
              onChange={(value) => applyFixedDiscount(value, lineTotal)}
              onKeyDown={handleDiscountKeyDown}
            />
          ) : (
            <NumberField
              fullWidth
              maxValue={100}
              minValue={0}
              value={discValue ?? Number.NaN}
              variant="secondary"
              onChange={(value) => setDiscValue(isEmptyNumberFieldValue(value) ? null : value)}
            >
              <Label>Nilai diskon (%)</Label>
              <NumberField.Group>
                <NumberField.DecrementButton aria-label="Kurangi persen diskon" />
                <NumberField.Input
                  className="text-right tabular-nums"
                  placeholder="0"
                  onKeyDown={handleDiscountKeyDown}
                />
                <NumberField.IncrementButton aria-label="Tambah persen diskon" />
              </NumberField.Group>
            </NumberField>
          )}
        </div>

        {belowCost && item.buy_price != null && (
          <p className="text-sm text-danger" role="alert">
            {id.cashier.ppobBelowCostHint(formatRupiah(item.buy_price))}
          </p>
        )}

        <SummaryList
          items={[
            { label: "Subtotal", value: formatRupiah(lineTotal) },
            ...(discAmount > 0
              ? [
                  {
                    label: "Diskon",
                    value: `-${formatRupiah(discAmount)}`,
                    tone: "danger" as const,
                  },
                ]
              : []),
            { label: "Total", value: formatRupiah(finalTotal), tone: "strong" },
          ]}
        />
      </Modal.Body>

      <Modal.Footer>
        {discAmount > 0 && (
          <Button type="button" variant="tertiary" onPress={handleReset}>
            Reset Diskon
          </Button>
        )}
        <Button isDisabled={belowCost} type="submit">
          Simpan
        </Button>
      </Modal.Footer>
    </Form>
  )
}
