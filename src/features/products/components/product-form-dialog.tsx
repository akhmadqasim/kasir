import { useState } from "react"
import {
  Button,
  ComboBox,
  Description,
  EmptyState,
  FieldError,
  Fieldset,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  NumberField,
  TextField,
} from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { RupiahField } from "@/components/rupiah-field"
import { id } from "@/i18n/id"
import { formatPercent, formatRupiah } from "@/lib/format"
import { useCreateProduct, useUpdateProduct } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import type { Product, CreateProductInput, UpdateProductInput } from "../types"

const UNITS = ["pcs", "kg", "liter", "pack", "box", "karton", "lusin", "dus"].map((unit) => ({
  key: unit,
  label: unit,
}))

/**
 * Nilai sentinel `ComboBox`: React Aria memakai `null` untuk "tidak ada pilihan",
 * dan `null` tidak bisa dipakai sebagai `id` item. Baris "Tanpa kategori"
 * menggantikan tombol silang milik combobox lama — sekarang bisa dicapai dengan
 * panah, bukan cuma dengan mouse, dan produk tanpa kategori menyebut keadaannya
 * alih-alih terlihat seperti kolom yang belum diisi.
 */
const NO_CATEGORY = "none"

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product | null
  onCreateSuccess?: () => void
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onCreateSuccess,
}: ProductFormDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog aria-label={product ? id.common.edit : id.products.add}>
          <Modal.CloseTrigger />
          {/* React Aria melepas dialognya saat ditutup, bukan menahannya sampai
              animasi keluar selesai, jadi state di bawah selalu lahir kosong.
              Membuka ulang untuk produk lain tidak lagi bisa menampilkan nilai
              produk sebelumnya di atas id yang baru. */}
          <ProductFormBody
            product={product}
            onOpenChange={onOpenChange}
            onCreateSuccess={onCreateSuccess}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface FormState {
  name: string
  barcode: string
  sku: string
  skuManual: boolean
  categoryId: string
  /** Rupiah bulat; `null` selama kolomnya kosong. */
  buyPrice: number | null
  sellPrice: number | null
  /** Persen, boleh pecahan; `null` selama kolomnya kosong. */
  margin: number | null
  stock: string
  unit: string
  minStock: string
}

const emptyForm: FormState = {
  name: "",
  barcode: "",
  sku: "",
  skuManual: false,
  categoryId: "",
  buyPrice: null,
  sellPrice: null,
  margin: null,
  stock: "",
  unit: "pcs",
  minStock: "",
}

/** Markup dalam persen dari harga modal ke harga jual, dua desimal. */
function markupPercent(buyPrice: number, sellPrice: number): number {
  return Math.round(((sellPrice - buyPrice) / buyPrice) * 10000) / 100
}

function buildFormFromProduct(p: Product): FormState {
  let margin: number | null = p.margin || null
  if (!p.margin && p.buy_price > 0 && p.sell_price > 0) {
    margin = markupPercent(p.buy_price, p.sell_price)
  }
  return {
    name: p.name,
    barcode: p.barcode || "",
    sku: p.sku || "",
    skuManual: true,
    categoryId: p.category_id ? String(p.category_id) : "",
    buyPrice: p.buy_price,
    sellPrice: p.sell_price,
    margin,
    stock: String(p.stock),
    unit: p.unit,
    minStock: String(p.min_stock),
  }
}

function ProductFormBody({
  product,
  onOpenChange,
  onCreateSuccess,
}: {
  product?: Product | null
  onOpenChange: (open: boolean) => void
  onCreateSuccess?: () => void
}) {
  const isEditing = !!product
  const { data: categories } = useCategories()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()

  const [form, setForm] = useState<FormState>(() =>
    product ? buildFormFromProduct(product) : emptyForm,
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const recalcSellPrice = (bp: number | null, m: number | null) => {
    if (bp != null && bp > 0 && m != null && m > 0) {
      setForm((prev) => ({ ...prev, sellPrice: Math.round(bp * (1 + m / 100)) }))
    }
  }

  const recalcMargin = (bp: number | null, sp: number | null) => {
    setForm((prev) => ({
      ...prev,
      margin: bp != null && bp > 0 && sp != null && sp > 0 ? markupPercent(bp, sp) : null,
    }))
  }

  const generateSku = (productName: string): string => {
    return productName.trim().replace(/\s+/g, "")
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!form.name.trim()) newErrors.name = "Nama produk wajib diisi"
    if (form.sellPrice == null || form.sellPrice <= 0)
      newErrors.sellPrice = "Harga jual harus lebih dari 0"
    if (form.buyPrice == null || form.buyPrice < 0) newErrors.buyPrice = "Harga modal tidak valid"
    if (form.stock === "" || Number(form.stock) < 0) newErrors.stock = "Stok tidak boleh negatif"
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const input: CreateProductInput = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || null,
      sku: form.sku.trim() || null,
      category_id: form.categoryId ? Number(form.categoryId) : null,
      buy_price: form.buyPrice ?? 0,
      sell_price: form.sellPrice ?? 0,
      margin: form.margin ?? 0,
      stock: Number(form.stock),
      unit: form.unit,
      min_stock: form.minStock ? Number(form.minStock) : 0,
    }

    if (isEditing && product) {
      const updateInput: UpdateProductInput = { ...input, id: product.id }
      updateProduct.mutate(updateInput, { onSuccess: () => onOpenChange(false) })
    } else {
      createProduct.mutate(input, {
        onSuccess: () => {
          onCreateSuccess?.()
          onOpenChange(false)
        },
      })
    }
  }

  const isPending = createProduct.isPending || updateProduct.isPending
  const { buyPrice, sellPrice } = form
  const actualMargin =
    buyPrice != null && buyPrice > 0 && sellPrice != null && sellPrice > 0
      ? formatPercent(markupPercent(buyPrice, sellPrice))
      : null

  return (
    // validationBehavior="aria" menahan validasi di komponen ini. Dengan default
    // React Aria ("native") kolom yang `isInvalid` memanggil setCustomValidity,
    // dan browser lalu memblokir tiap submit berikutnya — termasuk submit yang
    // justru akan membersihkan errornya.
    <Form
      className="flex min-h-0 flex-1 flex-col"
      validationBehavior="aria"
      onSubmit={handleSubmit}
    >
      <Modal.Header>
        <Modal.Heading>{isEditing ? id.common.edit : id.products.add}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <TextField
          fullWidth
          isInvalid={Boolean(errors.name)}
          value={form.name}
          variant="secondary"
          onChange={(value) =>
            setForm((prev) => ({
              ...prev,
              name: value,
              ...(!prev.skuManual ? { sku: generateSku(value) } : {}),
            }))
          }
        >
          <Label>{id.products.name} *</Label>
          <Input />
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
            <Input />
          </TextField>

          <TextField
            fullWidth
            value={form.sku}
            variant="secondary"
            onChange={(value) => setForm((prev) => ({ ...prev, sku: value, skuManual: true }))}
          >
            <Label>
              {id.products.sku}
              {!form.skuManual && <span className="ml-1.5 text-xs text-muted">(otomatis)</span>}
            </Label>
            <Input placeholder="AUTO" />
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
            type="number"
            value={form.stock}
            variant="secondary"
            onChange={(value) => updateField("stock", value)}
          >
            <Label>{id.products.stock} *</Label>
            <Input min="0" placeholder="0" />
            <FieldError>{errors.stock}</FieldError>
          </TextField>

          <OptionSelect
            fullWidth
            label={`${id.products.unit} *`}
            options={UNITS}
            value={form.unit}
            variant="secondary"
            onChange={(value) => updateField("unit", value ?? "")}
          />

          <TextField
            fullWidth
            type="number"
            value={form.minStock}
            variant="secondary"
            onChange={(value) => updateField("minStock", value)}
          >
            <Label>{id.products.minStock}</Label>
            <Input min="0" placeholder="0" />
          </TextField>
        </div>

        {/* Ketiga kolom berdiri langsung di atas permukaan dialog, tanpa
            `InfoPanel`: kolom `secondary` di atas `Surface secondary` menyatu
            dengan latarnya. Yang mengelompokkan mereka adalah `Fieldset`,
            bukan kotak abu-abu. */}
        <Fieldset className="gap-3">
          <Fieldset.Legend className="text-sm">Perhitungan Harga</Fieldset.Legend>
          <Fieldset.Group className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-end gap-2 space-y-0">
            <RupiahField
              errorMessage={errors.buyPrice}
              label={`${id.products.buyPrice} *`}
              placeholder="0"
              value={form.buyPrice}
              onChange={(value) => {
                updateField("buyPrice", value)
                recalcSellPrice(value, form.margin)
              }}
            />

            <span className="pb-2.5 text-base font-medium text-muted">×</span>

            {/* `NumberField` memformat menurut locale aplikasi (`id-ID`, koma
                desimal) dan baru melaporkan nilainya saat kolom ditinggalkan;
                harga jual dihitung ulang saat itu. Kolom kosong diwakili `NaN`,
                bukan `undefined`: `undefined` membuatnya beralih ke mode tak
                terkendali, dan React Aria tidak mengizinkan berpindah mode. */}
            <NumberField
              className="w-24"
              formatOptions={{ maximumFractionDigits: 2 }}
              minValue={0}
              value={form.margin ?? Number.NaN}
              variant="secondary"
              onChange={(value) => {
                const margin = Number.isNaN(value) ? null : value
                updateField("margin", margin)
                recalcSellPrice(form.buyPrice, margin)
              }}
            >
              <Label>Markup (%)</Label>
              <NumberField.Group>
                <NumberField.Input className="text-right tabular-nums" placeholder="0" />
              </NumberField.Group>
            </NumberField>

            <span className="pb-2.5 text-base font-medium text-muted">=</span>

            <RupiahField
              errorMessage={errors.sellPrice}
              label={`${id.products.sellPrice} *`}
              placeholder="0"
              value={form.sellPrice}
              onChange={(value) => {
                updateField("sellPrice", value)
                recalcMargin(form.buyPrice, value)
              }}
            />
          </Fieldset.Group>
          {actualMargin && (
            <Description>
              Margin aktual <span className="font-semibold text-foreground">{actualMargin}%</span> (
              {formatRupiah((sellPrice ?? 0) - (buyPrice ?? 0))} / item)
            </Description>
          )}
        </Fieldset>
      </Modal.Body>

      <Modal.Footer>
        <Button slot="close" type="button" variant="tertiary">
          {id.common.cancel}
        </Button>
        <PendingButton isPending={isPending} type="submit">
          {id.common.save}
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}

/**
 * Pemilih kategori: ketik untuk menyaring, panah untuk memilih.
 *
 * Kategori baru tetap tidak bisa dibuat dari sini — `create_product` hanya
 * menerima `category_id`, dan combobox lama juga mengembalikan teks yang tidak
 * cocok ke nama kategori terpilih begitu kolomnya kehilangan fokus. Karena itu
 * `allowsCustomValue` sengaja tidak dipasang: nama asing hanya akan tersimpan
 * sebagai produk tanpa kategori tanpa memberi tahu kasirnya.
 */
function CategoryComboBox({
  categories,
  value,
  onValueChange,
}: {
  categories: { id: number; name: string }[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <ComboBox
      allowsEmptyCollection
      fullWidth
      variant="secondary"
      // Sentinelnya harus benar-benar jadi kunci terpilih, bukan dipetakan balik
      // ke `null`: React Aria menutup popover lewat perubahan `selectedKey`, jadi
      // kunci yang tak pernah sampai membuat daftarnya menggantung terbuka.
      value={value || NO_CATEGORY}
      onChange={(key) => {
        const picked = Array.isArray(key) ? key[0] : key
        onValueChange(picked == null || picked === NO_CATEGORY ? "" : String(picked))
      }}
    >
      <Label>{id.products.category}</Label>
      <ComboBox.InputGroup>
        <Input placeholder="Pilih kategori..." />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          aria-label={id.products.category}
          renderEmptyState={() => <EmptyState>Kategori tidak ditemukan</EmptyState>}
        >
          <ListBox.Item id={NO_CATEGORY} textValue="Tanpa kategori">
            <Label>Tanpa kategori</Label>
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {categories.map((category) => (
            <ListBox.Item key={category.id} id={String(category.id)} textValue={category.name}>
              <Label>{category.name}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
