import { useState } from "react"
import {
  Button,
  ComboBox,
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
} from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { id } from "@/i18n/id"
import { useCreateProduct, useUpdateProduct } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import type { Product, CreateProductInput, UpdateProductInput } from "../types"

const UNITS = ["pcs", "kg", "liter", "pack", "box", "karton", "lusin", "dus"]

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
  buyPrice: string
  sellPrice: string
  margin: string
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
  buyPrice: "",
  sellPrice: "",
  margin: "",
  stock: "",
  unit: "pcs",
  minStock: "",
}

function buildFormFromProduct(p: Product): FormState {
  let margin = p.margin ? String(p.margin) : ""
  if (!p.margin && p.buy_price > 0 && p.sell_price > 0) {
    const m = ((p.sell_price - p.buy_price) / p.buy_price) * 100
    margin = m % 1 === 0 ? String(m) : m.toFixed(2)
  }
  return {
    name: p.name,
    barcode: p.barcode || "",
    sku: p.sku || "",
    skuManual: true,
    categoryId: p.category_id ? String(p.category_id) : "",
    buyPrice: String(p.buy_price),
    sellPrice: String(p.sell_price),
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
    product ? buildFormFromProduct(product) : emptyForm
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const recalcSellPrice = (bp: number, m: number) => {
    if (bp > 0 && m > 0) {
      setForm((prev) => ({ ...prev, sellPrice: String(Math.round(bp * (1 + m / 100))) }))
    }
  }

  const recalcMargin = (bp: number, sp: number) => {
    if (bp > 0 && sp > 0) {
      const m = ((sp - bp) / bp) * 100
      setForm((prev) => ({ ...prev, margin: m % 1 === 0 ? String(m) : m.toFixed(2) }))
    } else {
      setForm((prev) => ({ ...prev, margin: "" }))
    }
  }

  const generateSku = (productName: string): string => {
    return productName.trim().replace(/\s+/g, "")
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!form.name.trim()) newErrors.name = "Nama produk wajib diisi"
    if (!form.sellPrice || Number(form.sellPrice) <= 0) newErrors.sellPrice = "Harga jual harus lebih dari 0"
    if (!form.buyPrice || Number(form.buyPrice) < 0) newErrors.buyPrice = "Harga modal tidak valid"
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
      buy_price: Number(form.buyPrice),
      sell_price: Number(form.sellPrice),
      margin: form.margin ? Number(form.margin) : 0,
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
  const actualMargin = Number(form.buyPrice) > 0 && Number(form.sellPrice) > 0
    ? ((Number(form.sellPrice) - Number(form.buyPrice)) / Number(form.buyPrice) * 100).toFixed(1)
    : null

  return (
    // validationBehavior="aria" menahan validasi di komponen ini. Dengan default
    // React Aria ("native") kolom yang `isInvalid` memanggil setCustomValidity,
    // dan browser lalu memblokir tiap submit berikutnya — termasuk submit yang
    // justru akan membersihkan errornya.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.Header>
        <Modal.Heading>{isEditing ? id.common.edit : id.products.add}</Modal.Heading>
        <Modal.CloseTrigger />
      </Modal.Header>

      <Modal.Body className="space-y-4">
        <TextField
          fullWidth
          isInvalid={Boolean(errors.name)}
          value={form.name}
          onChange={(value) =>
            setForm((prev) => ({
              ...prev,
              name: value,
              ...(!prev.skuManual ? { sku: generateSku(value) } : {}),
            }))
          }
        >
          <Label>{id.products.name} *</Label>
          <Input placeholder={id.products.name} />
          <FieldError>{errors.name}</FieldError>
        </TextField>

        <div className="grid grid-cols-2 gap-4">
          <TextField
            fullWidth
            value={form.barcode}
            onChange={(value) => updateField("barcode", value)}
          >
            <Label>{id.products.barcode}</Label>
            <Input placeholder={id.products.barcode} />
          </TextField>

          <TextField
            fullWidth
            value={form.sku}
            onChange={(value) => setForm((prev) => ({ ...prev, sku: value, skuManual: true }))}
          >
            <Label>
              {id.products.sku}
              {!form.skuManual && <span className="ml-1.5 text-xs text-muted">(otomatis)</span>}
            </Label>
            <Input className={form.skuManual ? undefined : "text-muted"} placeholder="AUTO" />
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
            onChange={(value) => updateField("stock", value)}
          >
            <Label>{id.products.stock} *</Label>
            <Input min="0" placeholder="0" />
            <FieldError>{errors.stock}</FieldError>
          </TextField>

          <Select
            fullWidth
            value={form.unit}
            onChange={(value) => updateField("unit", value === null ? "" : String(value))}
          >
            <Label>{id.products.unit} *</Label>
            <Select.Trigger>
              <Select.Value>{selectedText}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {UNITS.map((unit) => (
                  <ListBox.Item key={unit} id={unit} textValue={unit}>
                    <Label>{unit}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <TextField
            fullWidth
            type="number"
            value={form.minStock}
            onChange={(value) => updateField("minStock", value)}
          >
            <Label>{id.products.minStock}</Label>
            <Input min="0" placeholder="0" />
          </TextField>
        </div>

        {/* Perhitungan Harga. Ketiga kolomnya tetap `TextField type="number"`
            dan bukan `NumberField`: nilainya saling menghitung ulang tiap
            ketukan, dan `NumberField` memformat isinya menurut locale — angka
            yang baru setengah diketik akan dirapikan di tengah pengetikan. */}
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Perhitungan Harga
          </p>
          <div className="rounded-lg border p-3">
            <div className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-end gap-2">
              <TextField
                fullWidth
                type="number"
                value={form.buyPrice}
                onChange={(value) => {
                  updateField("buyPrice", value)
                  recalcSellPrice(Number(value), Number(form.margin))
                }}
              >
                <Label className="text-xs">{id.products.buyPrice} *</Label>
                <Input min="0" placeholder="0" />
              </TextField>

              <span className="pb-2.5 text-base font-medium text-muted">×</span>

              <TextField
                className="w-20"
                type="number"
                value={form.margin}
                onChange={(value) => {
                  updateField("margin", value)
                  recalcSellPrice(Number(form.buyPrice), Number(value))
                }}
              >
                <Label className="text-xs">Markup (%)</Label>
                <Input min="0" placeholder="0" step="any" />
              </TextField>

              <span className="pb-2.5 text-base font-medium text-muted">=</span>

              <TextField
                fullWidth
                type="number"
                value={form.sellPrice}
                onChange={(value) => {
                  updateField("sellPrice", value)
                  recalcMargin(Number(form.buyPrice), Number(value))
                }}
              >
                <Label className="text-xs">{id.products.sellPrice} *</Label>
                <Input min="0" placeholder="0" />
              </TextField>
            </div>
            {(errors.buyPrice || errors.sellPrice) && (
              <div className="mt-2 space-y-1">
                {errors.buyPrice && <p className="text-xs font-medium text-danger">{errors.buyPrice}</p>}
                {errors.sellPrice && <p className="text-xs font-medium text-danger">{errors.sellPrice}</p>}
              </div>
            )}
            {actualMargin && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <span>Margin aktual:</span>
                <span className="font-semibold text-foreground">{actualMargin}%</span>
                <span>
                  (Rp {(Number(form.sellPrice) - Number(form.buyPrice)).toLocaleString("id-ID")} / item)
                </span>
              </div>
            )}
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button type="button" variant="outline" onPress={() => onOpenChange(false)}>
          {id.common.cancel}
        </Button>
        <Button isDisabled={isPending} type="submit">
          {isPending ? id.common.loading : id.common.save}
        </Button>
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
          renderEmptyState={() => (
            <p className="px-3 py-6 text-center text-sm text-muted">Kategori tidak ditemukan</p>
          )}
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
