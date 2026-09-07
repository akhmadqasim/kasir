import { useState } from "react"
import {
  Button,
  FieldError,
  Form,
  Label,
  ListBox,
  Modal,
  NumberField,
  Select,
  TextArea,
  TextField,
} from "@heroui/react"

import { ProductAutocomplete } from "@/components/product-autocomplete"
import { selectedText } from "@/components/selected-text"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useCreateWriteoff } from "../hooks/use-stock-writeoffs"
import type { Product } from "@/features/products/types"

const REASONS = [
  { key: "damaged", label: "Rusak" },
  { key: "expired", label: "Kadaluarsa" },
  { key: "lost", label: "Hilang" },
  { key: "other", label: "Lainnya" },
] as const

interface WriteoffFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WriteoffFormDialog({ open, onOpenChange }: WriteoffFormDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="md">
        <Modal.Dialog aria-label="Buat Write-off Baru">
          {/* React Aria unmounts the dialog on close, so the form state below is
              recreated on every open — no stale product from the previous run. */}
          <WriteoffFormBody onOpenChange={onOpenChange} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function WriteoffFormBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const user = useAuthStore((s) => s.user)
  const createWriteoff = useCreateWriteoff()

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const lossValue = selectedProduct && quantity ? selectedProduct.buy_price * quantity : 0

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!selectedProduct) newErrors.product = "Pilih produk terlebih dahulu"
    if (!quantity || quantity <= 0) newErrors.quantity = "Jumlah harus lebih dari 0"
    if (selectedProduct && quantity && quantity > selectedProduct.stock) {
      newErrors.quantity = `Maks. stok tersedia: ${selectedProduct.stock}`
    }
    if (!reason) newErrors.reason = "Pilih alasan write-off"
    // Only admin can write off lost items
    if (reason === "lost" && user?.role !== "admin") {
      newErrors.reason = "Hanya admin yang dapat melakukan write-off barang hilang"
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!validate() || !selectedProduct || !quantity || !user) return

    createWriteoff.mutate(
      {
        productId: selectedProduct.id,
        quantity,
        reason,
        notes: notes.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  return (
    // validationBehavior="aria" keeps validation in this component. With React
    // Aria's default ("native") an `isInvalid` field calls setCustomValidity, and
    // the browser then blocks every later submit — including the one that would
    // clear the error.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.Header>
        <Modal.Heading>Buat Write-off Baru</Modal.Heading>
        <Modal.CloseTrigger />
      </Modal.Header>

      <Modal.Body className="space-y-4">
        <p className="text-sm text-muted">
          Catat barang yang rusak, kadaluarsa, atau hilang dari stok.
        </p>

        <div className="space-y-2">
          <ProductAutocomplete
            label="Produk *"
            placeholder="Pilih produk"
            searchPlaceholder="Cari nama produk atau barcode..."
            errorMessage={errors.product}
            value={selectedProduct}
            onSelect={(product) => {
              setSelectedProduct(product)
              clearError("product")
              clearError("quantity")
            }}
            renderDetail={(product) =>
              `Stok: ${product.stock} ${product.unit} · ${formatRupiah(product.buy_price)} (modal)`
            }
          />
          {selectedProduct && (
            <div className="rounded-md border bg-default/50 px-3 py-2 text-sm">
              <span className="font-medium">{selectedProduct.name}</span>
              <span className="ml-2 text-muted">
                · Stok: {selectedProduct.stock} {selectedProduct.unit}· Modal:{" "}
                {formatRupiah(selectedProduct.buy_price)}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <NumberField
            fullWidth
            isInvalid={Boolean(errors.quantity)}
            maxValue={selectedProduct?.stock}
            minValue={1}
            value={quantity ?? Number.NaN}
            onChange={(value) => {
              setQuantity(value === undefined || Number.isNaN(value) ? null : value)
              clearError("quantity")
            }}
          >
            <Label>Jumlah *</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input placeholder="0" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <FieldError>{errors.quantity}</FieldError>
          </NumberField>

          <Select
            fullWidth
            isInvalid={Boolean(errors.reason)}
            placeholder="Pilih alasan"
            value={reason || null}
            onChange={(value) => {
              setReason(value === null ? "" : String(value))
              clearError("reason")
            }}
          >
            <Label>Alasan *</Label>
            <Select.Trigger>
              <Select.Value>{selectedText}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {REASONS.map((option) => (
                  <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                    <Label>{option.label}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
            <FieldError>{errors.reason}</FieldError>
          </Select>
        </div>

        <TextField fullWidth value={notes} onChange={setNotes}>
          <Label>Catatan</Label>
          <TextArea placeholder="Catatan tambahan (opsional)..." rows={2} />
        </TextField>

        {lossValue > 0 && (
          <div className="rounded-lg border border-danger/20 bg-danger-soft p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-danger-soft-foreground">
                Estimasi Kerugian
              </span>
              <span className="text-lg font-bold text-danger-soft-foreground">
                {formatRupiah(lossValue)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {formatRupiah(selectedProduct?.buy_price ?? 0)} × {quantity ?? 0}{" "}
              {selectedProduct?.unit}
            </p>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button type="button" variant="tertiary" onPress={() => onOpenChange(false)}>
          {id.common.cancel}
        </Button>
        <Button isDisabled={createWriteoff.isPending} type="submit">
          {createWriteoff.isPending ? id.common.loading : "Buat Write-off"}
        </Button>
      </Modal.Footer>
    </Form>
  )
}
