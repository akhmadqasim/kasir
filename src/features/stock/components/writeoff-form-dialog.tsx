import { useState } from "react"
import { PackageMinus } from "lucide-react"
import {
  Alert,
  Button,
  FieldError,
  Form,
  Label,
  Modal,
  NumberField,
  TextArea,
  TextField,
} from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { ProductAutocomplete } from "@/components/product-autocomplete"
import { SummaryList } from "@/components/summary-list"
import { useFieldErrors } from "@/hooks/use-field-errors"
import { id } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { isEmptyNumberFieldValue } from "@/lib/number-field"
import { useAuthStore } from "@/features/auth"
import { useCreateWriteoff } from "../hooks/use-stock-writeoffs"
import { WRITEOFF_REASON_OPTIONS } from "../labels"
import type { Product } from "@/features/products/types"

const OUT_OF_STOCK_MESSAGE = id.validation.writeoffOutOfStock

type WriteoffField = "product" | "quantity" | "reason"

interface WriteoffFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WriteoffFormDialog({ open, onOpenChange }: WriteoffFormDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
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
  const isAdmin = user?.role === "admin"
  const createWriteoff = useCreateWriteoff()

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const { errors, setErrors, clearError } = useFieldErrors<WriteoffField>()

  const lossValue = selectedProduct && quantity ? selectedProduct.buy_price * quantity : 0

  const validate = (): boolean => {
    const newErrors: Partial<Record<WriteoffField, string>> = {}
    if (!selectedProduct) newErrors.product = id.validation.productRequired
    if (!quantity || quantity <= 0) newErrors.quantity = id.validation.quantityPositive
    else if (!Number.isInteger(quantity)) newErrors.quantity = id.validation.quantityInteger
    if (selectedProduct && selectedProduct.stock <= 0) {
      newErrors.quantity = OUT_OF_STOCK_MESSAGE
    } else if (selectedProduct && quantity && quantity > selectedProduct.stock) {
      newErrors.quantity = id.validation.quantityOverStock(formatNumber(selectedProduct.stock))
    }
    if (!reason) newErrors.reason = id.validation.writeoffReasonRequired
    // Only admin can write off lost items
    if (reason === "lost" && !isAdmin) {
      newErrors.reason = id.validation.lostWriteoffAdminOnly
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Enter in a field submits even while the button shows its spinner.
    if (createWriteoff.isPending) return
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

  return (
    // validationBehavior="aria" keeps validation in this component. With React
    // Aria's default ("native") an `isInvalid` field calls setCustomValidity, and
    // the browser then blocks every later submit — including the one that would
    // clear the error. Under "aria", `isRequired` only marks a field (the label's
    // asterisk, `aria-required`) and validates nothing.
    <Form
      className="flex min-h-0 flex-1 flex-col"
      validationBehavior="aria"
      onSubmit={handleSubmit}
    >
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <PackageMinus className="size-5" />
        </Modal.Icon>
        <Modal.Heading>Buat Write-off Baru</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <p>Catat barang yang rusak, kadaluarsa, atau hilang dari stok.</p>
        <div className="flex flex-col gap-2">
          <ProductAutocomplete
            isRequired
            label="Produk"
            placeholder="Pilih produk"
            searchPlaceholder="Cari nama produk atau barcode..."
            errorMessage={errors.product}
            value={selectedProduct}
            onSelect={(product) => {
              setSelectedProduct(product)
              clearError("product")
              clearError("quantity")
              // Say so right away instead of letting the cashier fill in the
              // rest of the form only to be told on submit.
              if (product && product.stock <= 0) {
                setErrors((prev) => ({ ...prev, quantity: OUT_OF_STOCK_MESSAGE }))
              }
            }}
            renderDetail={(product) =>
              `Stok: ${formatNumber(product.stock)} ${product.unit} · ${formatRupiah(product.buy_price)} (modal)`
            }
          />
          {selectedProduct && (
            <InfoPanel>
              <SummaryList
                layout="grid"
                items={[
                  { label: "Produk", value: selectedProduct.name },
                  {
                    label: "Stok",
                    value: `${formatNumber(selectedProduct.stock)} ${selectedProduct.unit}`,
                  },
                  { label: "Modal", value: formatRupiah(selectedProduct.buy_price) },
                ]}
              />
            </InfoPanel>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Bilangan bulat saja: stok disimpan sebagai INTEGER. `maxValue`
              hanya dipasang kalau stoknya positif — di bawah `minValue` React
              Aria menjepit nilainya ke angka yang tidak masuk akal. */}
          <NumberField
            fullWidth
            formatOptions={{ maximumFractionDigits: 0 }}
            isInvalid={Boolean(errors.quantity)}
            isRequired
            maxValue={
              selectedProduct && selectedProduct.stock >= 1 ? selectedProduct.stock : undefined
            }
            minValue={1}
            variant="secondary"
            value={quantity ?? Number.NaN}
            onChange={(value) => {
              setQuantity(isEmptyNumberFieldValue(value) ? null : value)
              clearError("quantity")
            }}
          >
            <Label>Jumlah</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="text-right tabular-nums" placeholder="0" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            {/* Tanpa `Description` "Maks. N": stoknya sudah tertulis di
                ringkasan produk tepat di atas (DESIGN.md §5.7, satu keterangan). */}
            <FieldError>{errors.quantity}</FieldError>
          </NumberField>

          {/* Barang hilang hanya boleh dicatat admin (tidak ada bukti fisik).
              Pilihannya dimatikan untuk kasir alih-alih ditolak setelah
              dikirim, dan keterangannya menyebut alasannya. */}
          <OptionSelect
            fullWidth
            description={isAdmin ? undefined : "Barang hilang hanya bisa dicatat admin"}
            disabledKeys={isAdmin ? undefined : ["lost"]}
            errorMessage={errors.reason}
            isRequired
            label="Alasan"
            options={WRITEOFF_REASON_OPTIONS}
            placeholder="Pilih alasan"
            value={reason || null}
            variant="secondary"
            onChange={(value) => {
              setReason(value ?? "")
              clearError("reason")
            }}
          />
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
              <Alert.Description className="tabular-nums">
                <span className="font-semibold">{formatRupiah(lossValue)}</span>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, dari </span>
                {formatRupiah(selectedProduct?.buy_price ?? 0)} × {formatNumber(quantity ?? 0)}{" "}
                {selectedProduct?.unit}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button isDisabled={createWriteoff.isPending} slot="close" variant="tertiary">
          {id.common.cancel}
        </Button>
        <PendingButton isPending={createWriteoff.isPending} type="submit">
          Buat Write-off
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}
