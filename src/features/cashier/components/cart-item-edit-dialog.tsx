import { useEffect, useRef, useState } from "react"
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Separator,
  TextField,
} from "@heroui/react"
import { Minus, Plus } from "lucide-react"

import { selectedText } from "@/components/selected-text"
import { MAX_CART_QUANTITY, useCartStore } from "../hooks/use-cart-store"
import type { CartItem } from "../types"
import { formatRupiah, getQuantityWarning } from "../utils"

const DISCOUNT_TYPES = [
  { key: "fixed", label: "Nominal (Rp)" },
  { key: "percentage", label: "Persen (%)" },
] as const

interface CartItemEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: CartItem | null
}

export function CartItemEditDialog({
  open,
  onOpenChange,
  item,
}: CartItemEditDialogProps) {
  if (!item) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={item.product_name}>
          {/* Body hanya hidup selama dialog terbuka dan di-key per baris keranjang,
              jadi state form-nya lahir dari item yang benar tanpa perlu efek
              penyelaras yang bisa menimpa ketikan kasir. */}
          <CartItemEditBody
            key={item.cart_id}
            item={item}
            onOpenChange={onOpenChange}
          />
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
  const [qty, setQty] = useState(item.quantity)
  const [qtyRaw, setQtyRaw] = useState(String(item.quantity))
  const [discType, setDiscType] = useState<"fixed" | "percentage">(disc?.type ?? "fixed")
  const [discRaw, setDiscRaw] = useState(disc ? String(disc.value) : "")
  const qtyInputRef = useRef<HTMLInputElement>(null)

  const lineTotal = item.product_price * qty
  const quantityWarning = getQuantityWarning(item, qty)
  const discValue = Number(discRaw) || 0
  const discAmount =
    discType === "percentage"
      ? Math.round((lineTotal * Math.min(discValue, 100)) / 100)
      : Math.min(discValue, lineTotal)
  const finalTotal = Math.max(0, lineTotal - discAmount)

  const clampQty = (value: number) => Math.min(Math.max(1, value), MAX_CART_QUANTITY)

  const handleQtyChange = (newQty: number) => {
    const validated = clampQty(newQty)
    setQty(validated)
    setQtyRaw(String(validated))
  }

  const handleQtyInputChange = (value: string) => {
    // Batasi panjang input agar barcode 13 digit tidak bisa jadi jumlah
    const cleaned = value.replace(/[^\d]/g, "").slice(0, String(MAX_CART_QUANTITY).length)
    setQtyRaw(cleaned)

    if (!cleaned) return

    const parsed = parseInt(cleaned, 10)
    if (!isNaN(parsed)) {
      setQty(clampQty(parsed))
    }
  }

  const handleDiscChange = (value: string) => {
    setDiscRaw(value.replace(/[^\d]/g, ""))
  }

  const formatDiscDisplay = (raw: string): string => {
    if (!raw || discType === "percentage") return raw
    const num = Number(raw)
    if (isNaN(num) || num === 0) return raw
    return num.toLocaleString("id-ID")
  }

  const handleTypeChange = (newType: "fixed" | "percentage") => {
    setDiscType(newType)
    setDiscRaw("")
  }

  const handleSave = () => {
    const normalizedQty = clampQty(parseInt(qtyRaw || String(qty), 10) || qty)
    setQty(normalizedQty)
    setQtyRaw(String(normalizedQty))

    // Update quantity
    if (!item.is_ppob) {
      updateQuantity(item.cart_id, normalizedQty)
    }

    // Update discount
    const parsedDisc = Number(discRaw) || 0
    const clampedDisc =
      discType === "percentage" ? Math.min(parsedDisc, 100) : parsedDisc
    if (clampedDisc > 0) {
      setItemDiscount(item.cart_id, { type: discType, value: clampedDisc })
    } else {
      setItemDiscount(item.cart_id, null)
    }

    onOpenChange(false)
  }

  const handleReset = () => {
    setDiscType("fixed")
    setDiscRaw("")
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
    <>
      <Modal.Header>
        <Modal.Heading className="leading-snug">{item.product_name}</Modal.Heading>
        <Modal.CloseTrigger />
      </Modal.Header>

      <Modal.Body className="space-y-4">
        {/* Price info */}
        <div className="text-sm text-muted">
          Harga: {formatRupiah(item.product_price)} / {item.unit ?? "pcs"}
        </div>

        {/* Quantity */}
        {!item.is_ppob && (
          <div className="space-y-2">
            {/* Judul blok, bukan label kolom: kolomnya sendiri diberi `aria-label`
                supaya tidak ada `<label>` yang menggantung tanpa kolom. */}
            <p className="text-sm font-medium">Jumlah</p>
            <div className="flex items-center gap-2">
              <Button
                aria-label="Kurangi jumlah"
                className="h-9 w-9"
                isDisabled={qty <= 1}
                isIconOnly
                variant="outline"
                onPress={() => handleQtyChange(qty - 1)}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <TextField
                aria-label="Jumlah"
                value={qtyRaw}
                onChange={handleQtyInputChange}
              >
                <Input
                  ref={qtyInputRef}
                  className="h-9 w-20 text-center text-lg font-semibold tabular-nums"
                  inputMode="numeric"
                  onBlur={() => setQtyRaw(String(qty))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave()
                  }}
                />
              </TextField>
              <Button
                aria-label="Tambah jumlah"
                className="h-9 w-9"
                isDisabled={qty >= MAX_CART_QUANTITY}
                isIconOnly
                variant="outline"
                onPress={() => handleQtyChange(qty + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {quantityWarning && (
              <p className="text-sm font-medium text-warning">{quantityWarning}</p>
            )}
          </div>
        )}

        <Separator />

        {/* Discount */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Diskon</p>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Jenis diskon"
              className="w-[130px]"
              value={discType}
              onChange={(value) => handleTypeChange(value as "fixed" | "percentage")}
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
              className="flex-1"
              value={formatDiscDisplay(discRaw)}
              onChange={handleDiscChange}
            >
              <Input
                className="h-9 text-right tabular-nums"
                inputMode="numeric"
                placeholder={discType === "percentage" ? "Persentase (%)" : "Nominal (Rp)"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave()
                }}
              />
            </TextField>
          </div>
          {discAmount > 0 && (
            <p className="text-sm tabular-nums text-danger">
              Potongan: -{formatRupiah(discAmount)}
            </p>
          )}
        </div>

        <Separator />

        {/* Summary */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span className="tabular-nums">{formatRupiah(lineTotal)}</span>
          </div>
          {discAmount > 0 && (
            <div className="flex justify-between text-danger">
              <span>Diskon</span>
              <span className="tabular-nums">-{formatRupiah(discAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatRupiah(finalTotal)}</span>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {discAmount > 0 && (
          <Button variant="outline" onPress={handleReset}>
            Reset Diskon
          </Button>
        )}
        <Button onPress={handleSave}>Simpan</Button>
      </Modal.Footer>
    </>
  )
}
