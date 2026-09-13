import { useEffect, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent } from "react"
import { Button, Description, Form, Label, Modal, NumberField } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { RupiahField } from "@/components/rupiah-field"
import { SummaryList } from "@/components/summary-list"
import { isEmptyNumberFieldValue } from "@/lib/number-field"
import { MAX_CART_QUANTITY, useCartStore } from "@/stores/cart-store"
import type { CartItem } from "../types"
import { DISCOUNT_TYPES, formatRupiah, getQuantityWarning } from "../utils"

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
  // Jumlah valid terakhir — dipakai untuk total dan peringatan. Batasnya
  // (1..MAX_CART_QUANTITY, kelipatan 1) sudah dijaga oleh `minValue`/`maxValue`/
  // `step` pada `NumberField` di bawah; state ini cuma menyaring nilai
  // kosong/NaN yang muncul saat kolomnya sedang dikosongkan.
  const [qty, setQty] = useState(item.quantity)
  const [discType, setDiscType] = useState<"fixed" | "percentage">(disc?.type ?? "fixed")
  const [discValue, setDiscValue] = useState<number | null>(disc?.value ?? null)
  const qtyInputRef = useRef<HTMLInputElement>(null)

  const lineTotal = item.product_price * qty
  const quantityWarning = getQuantityWarning(item, qty)
  const rawDisc = discValue ?? 0
  const discAmount =
    discType === "percentage"
      ? Math.round((lineTotal * Math.min(rawDisc, 100)) / 100)
      : Math.min(rawDisc, lineTotal)
  const finalTotal = Math.max(0, lineTotal - discAmount)

  const handleQtyChange = (value: number | undefined) => {
    if (isEmptyNumberFieldValue(value)) return
    setQty(value)
  }

  const handleTypeChange = (newType: "fixed" | "percentage") => {
    setDiscType(newType)
    setDiscValue(null)
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!item.is_ppob) {
      updateQuantity(item.cart_id, qty)
    }

    // Persen dijepit ke 100 di sini juga, bukan cuma di `discAmount`:
    // `setItemDiscount` sendiri tidak memvalidasi batas atas, jadi ini satu-
    // satunya penjaga kalau nilainya datang dari diskon lama yang sudah lewat
    // 100 tanpa sempat diketik ulang di kolom ini.
    const savedDisc = discType === "percentage" ? Math.min(rawDisc, 100) : rawDisc
    setItemDiscount(item.cart_id, savedDisc > 0 ? { type: discType, value: savedDisc } : null)

    onOpenChange(false)
  }

  const handleReset = () => {
    setDiscType("fixed")
    setDiscValue(null)
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
        <p>
          Harga: {formatRupiah(item.product_price)} / {item.unit ?? "pcs"}
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
                onKeyDown={submitOnEnter}
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
              onChange={setDiscValue}
              onKeyDown={submitOnEnter}
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
                <NumberField.DecrementButton />
                <NumberField.Input
                  className="text-right tabular-nums"
                  placeholder="0"
                  onKeyDown={submitOnEnter}
                />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          )}
        </div>

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
        <Button type="submit">Simpan</Button>
      </Modal.Footer>
    </Form>
  )
}
