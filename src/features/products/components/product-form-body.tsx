import { useState } from "react"
import { Package } from "lucide-react"
import { Button, FieldError, Form, Input, Label, Modal, TextField } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { useFieldErrors } from "@/hooks/use-field-errors"
import { id } from "@/i18n/id"
import { useCreateProduct, useUpdateProduct } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import {
  EMPTY_PRODUCT_FORM,
  UNITS,
  formFromProduct,
  generateSku,
  markupFromPrices,
  sellPriceFromMarkup,
  toCreateInput,
  toUpdateInput,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormState,
} from "../product-form"
import { CategoryComboBox } from "./category-combo-box"
import { ProductPriceFields } from "./product-price-fields"
import type { Product } from "../types"

interface ProductFormBodyProps {
  product?: Product | null
  onOpenChange: (open: boolean) => void
  onCreateSuccess?: () => void
}

/** Isi dialog tambah/ubah produk: formulir, header dan footer-nya. */
export function ProductFormBody({ product, onOpenChange, onCreateSuccess }: ProductFormBodyProps) {
  const isEditing = !!product
  const { data: categories } = useCategories()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()

  const [form, setForm] = useState<ProductFormState>(() =>
    product ? formFromProduct(product) : EMPTY_PRODUCT_FORM,
  )
  const { errors, setErrors, clearError } = useFieldErrors<keyof ProductFormErrors>()

  const updateField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const isPending = createProduct.isPending || updateProduct.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Enter in a field submits the form even while the button shows its
    // spinner, so the guard lives here and not only on the button.
    if (isPending) return
    const nextErrors = validateProductForm(form, product?.stock)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    if (product) {
      updateProduct.mutate(toUpdateInput(form, product), {
        onSuccess: () => onOpenChange(false),
      })
    } else {
      createProduct.mutate(toCreateInput(form), {
        onSuccess: () => {
          onCreateSuccess?.()
          onOpenChange(false)
        },
      })
    }
  }

  return (
    // validationBehavior="aria" menahan validasi di komponen ini. Dengan default
    // React Aria ("native") kolom yang `isInvalid` memanggil setCustomValidity,
    // dan browser lalu memblokir tiap submit berikutnya — termasuk submit yang
    // justru akan membersihkan errornya. Dengan "aria", `isRequired` hanya
    // menandai kolomnya (bintang di label, `aria-required`) tanpa ikut memvalidasi.
    <Form
      className="flex min-h-0 flex-1 flex-col"
      validationBehavior="aria"
      onSubmit={handleSubmit}
    >
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <Package className="size-5" />
        </Modal.Icon>
        <Modal.Heading>{isEditing ? "Ubah Produk" : id.products.add}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <TextField
          fullWidth
          isInvalid={Boolean(errors.name)}
          isRequired
          value={form.name}
          variant="secondary"
          onChange={(value) => {
            setForm((prev) => ({
              ...prev,
              name: value,
              ...(!prev.skuManual ? { sku: generateSku(value) } : {}),
            }))
            clearError("name")
          }}
        >
          <Label>{id.products.name}</Label>
          {/* Kolom pertama yang diisi: kursor langsung di sini begitu dialog
              terbuka, jadi kasir bisa mengetik tanpa meraih mouse. */}
          <Input autoFocus />
          <FieldError>{errors.name}</FieldError>
        </TextField>

        <div className="grid grid-cols-2 gap-4">
          <TextField
            fullWidth
            value={form.barcode}
            variant="secondary"
            onChange={(value) => updateField("barcode", value)}
          >
            <Label>{id.products.barcode}</Label>
            <Input autoComplete="off" />
          </TextField>

          <TextField
            fullWidth
            value={form.sku}
            variant="secondary"
            onChange={(value) => setForm((prev) => ({ ...prev, sku: value, skuManual: true }))}
          >
            <Label>
              {id.products.sku}
              {!form.skuManual && form.sku && (
                <span className="ml-1.5 text-xs text-muted">(otomatis)</span>
              )}
            </Label>
            <Input placeholder="Otomatis dari nama" />
          </TextField>
        </div>

        <CategoryComboBox
          categories={categories ?? []}
          value={form.categoryId}
          onValueChange={(value) => updateField("categoryId", value)}
        />

        <div className="grid grid-cols-3 gap-4">
          <TextField
            fullWidth
            isInvalid={Boolean(errors.stock)}
            isRequired
            type="number"
            value={form.stock}
            variant="secondary"
            onChange={(value) => {
              updateField("stock", value)
              clearError("stock")
            }}
          >
            <Label>{id.products.stock}</Label>
            <Input
              className="text-right tabular-nums"
              inputMode="numeric"
              min="0"
              placeholder="0"
              step="1"
            />
            <FieldError>{errors.stock}</FieldError>
          </TextField>

          <OptionSelect
            fullWidth
            isRequired
            label={id.products.unit}
            options={UNITS}
            value={form.unit}
            variant="secondary"
            onChange={(value) => updateField("unit", value ?? "")}
          />

          <TextField
            fullWidth
            isInvalid={Boolean(errors.minStock)}
            type="number"
            value={form.minStock}
            variant="secondary"
            onChange={(value) => {
              updateField("minStock", value)
              clearError("minStock")
            }}
          >
            <Label>{id.products.minStock}</Label>
            <Input
              className="text-right tabular-nums"
              inputMode="numeric"
              min="0"
              placeholder="0"
              step="1"
            />
            <FieldError>{errors.minStock}</FieldError>
          </TextField>
        </div>

        <ProductPriceFields
          buyPrice={form.buyPrice}
          buyPriceError={errors.buyPrice}
          margin={form.margin}
          sellPrice={form.sellPrice}
          sellPriceError={errors.sellPrice}
          unit={form.unit}
          onBuyPriceChange={(value) => {
            const sellPrice = sellPriceFromMarkup(value, form.margin)
            setForm((prev) => ({
              ...prev,
              buyPrice: value,
              ...(sellPrice != null ? { sellPrice } : {}),
            }))
            clearError("buyPrice")
          }}
          onMarginChange={(margin) => {
            const sellPrice = sellPriceFromMarkup(form.buyPrice, margin)
            setForm((prev) => ({ ...prev, margin, ...(sellPrice != null ? { sellPrice } : {}) }))
          }}
          onSellPriceChange={(value) => {
            setForm((prev) => ({
              ...prev,
              sellPrice: value,
              margin: markupFromPrices(form.buyPrice, value),
            }))
            clearError("sellPrice")
          }}
        />
      </Modal.Body>

      <Modal.Footer>
        <Button isDisabled={isPending} slot="close" type="button" variant="tertiary">
          {id.common.cancel}
        </Button>
        <PendingButton isPending={isPending} type="submit">
          {id.common.save}
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}
