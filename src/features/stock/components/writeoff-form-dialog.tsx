import { useState } from "react"
import {
  Alert,
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

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { ProductAutocomplete } from "@/components/product-autocomplete"
import { selectedText } from "@/components/selected-text"
import { SummaryList } from "@/components/summary-list"
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
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>Buat Write-off Baru</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <p>Catat barang yang rusak, kadaluarsa, atau hilang dari stok.</p>
        <div className="flex flex-col gap-2">
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
            <InfoPanel>
              <SummaryList
                layout="grid"
                items={[
                  { label: "Produk", value: selectedProduct.name },
                  { label: "Stok", value: `${selectedProduct.stock} ${selectedProduct.unit}` },
                  { label: "Modal", value: formatRupiah(selectedProduct.buy_price) },
                ]}
              />
            </InfoPanel>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <NumberField
            fullWidth
            isInvalid={Boolean(errors.quantity)}
            maxValue={selectedProduct?.stock}
            minValue={1}
            variant="secondary"
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
            variant="secondary"
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

        <TextField fullWidth value={notes} variant="secondary" onChange={setNotes}>
          <Label>Catatan</Label>
          <TextArea placeholder="Catatan tambahan (opsional)..." rows={2} />
        </TextField>

        {lossValue > 0 && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Estimasi Kerugian</Alert.Title>
              <Alert.Description>
                <span className="font-medium">{formatRupiah(lossValue)}</span> ·{" "}
                {formatRupiah(selectedProduct?.buy_price ?? 0)} × {quantity ?? 0}{" "}
                {selectedProduct?.unit}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button slot="close" variant="tertiary">
          {id.common.cancel}
        </Button>
        <PendingButton isPending={createWriteoff.isPending} type="submit">
          Buat Write-off
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}
