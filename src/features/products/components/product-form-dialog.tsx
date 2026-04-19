import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useCreateProduct, useUpdateProduct } from "../hooks/use-products"
import { useCategories } from "../hooks/use-categories"
import type { Product, CreateProductInput, UpdateProductInput } from "../types"

const UNITS = ["pcs", "kg", "liter", "pack", "box", "karton", "lusin", "dus"]

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product | null
}

export function ProductFormDialog({ open, onOpenChange, product }: ProductFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <ProductFormBody product={product} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
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

function ProductFormBody({ product, onOpenChange }: { product?: Product | null; onOpenChange: (open: boolean) => void }) {
  const isEditing = !!product
  const user = useAuthStore((s) => s.user)
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
      updateProduct.mutate(
        { input: updateInput, callerId: user!.id },
        { onSuccess: () => onOpenChange(false) }
      )
    } else {
      createProduct.mutate(
        { input, callerId: user!.id },
        { onSuccess: () => onOpenChange(false) }
      )
    }
  }

  const isPending = createProduct.isPending || updateProduct.isPending
  const actualMargin = Number(form.buyPrice) > 0 && Number(form.sellPrice) > 0
    ? ((Number(form.sellPrice) - Number(form.buyPrice)) / Number(form.buyPrice) * 100).toFixed(1)
    : null

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEditing ? id.common.edit : id.products.add}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{id.products.name} *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => {
                  const val = e.target.value
                  setForm((prev) => ({
                    ...prev,
                    name: val,
                    ...(!prev.skuManual ? { sku: generateSku(val) } : {}),
                  }))
                }}
                placeholder={id.products.name}
              />
              {errors.name && <p className="text-sm font-medium text-destructive">{errors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="barcode">{id.products.barcode}</Label>
                <Input
                  id="barcode"
                  value={form.barcode}
                  onChange={(e) => updateField("barcode", e.target.value)}
                  placeholder={id.products.barcode}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sku" className="flex items-center gap-1.5">
                  {id.products.sku}
                  {!form.skuManual && (
                    <span className="text-xs text-muted-foreground">(otomatis)</span>
                  )}
                </Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value, skuManual: true }))}
                  placeholder="AUTO"
                  className={!form.skuManual ? "text-muted-foreground" : ""}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{id.products.category}</Label>
              <CategoryCombobox
                categories={categories ?? []}
                value={form.categoryId}
                onValueChange={(v) => updateField("categoryId", v)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stock">{id.products.stock} *</Label>
                <Input
                  id="stock"
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={(e) => updateField("stock", e.target.value)}
                  placeholder="0"
                />
                {errors.stock && <p className="text-sm font-medium text-destructive">{errors.stock}</p>}
              </div>
              <div className="space-y-2">
                <Label>{id.products.unit} *</Label>
                <Select value={form.unit} onValueChange={(v) => updateField("unit", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="minStock">{id.products.minStock}</Label>
                <Input
                  id="minStock"
                  type="number"
                  min="0"
                  value={form.minStock}
                  onChange={(e) => updateField("minStock", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Perhitungan Harga */}
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Perhitungan Harga
              </Label>
              <div className="rounded-lg border p-3">
                <div className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="buyPrice" className="text-xs">{id.products.buyPrice} *</Label>
                    <Input
                      id="buyPrice"
                      type="number"
                      min="0"
                      value={form.buyPrice}
                      onChange={(e) => {
                        updateField("buyPrice", e.target.value)
                        recalcSellPrice(Number(e.target.value), Number(form.margin))
                      }}
                      placeholder="0"
                    />
                  </div>
                  <span className="pb-2.5 text-base font-medium text-muted-foreground">×</span>
                  <div className="space-y-1.5">
                    <Label htmlFor="margin" className="text-xs">Markup (%)</Label>
                    <Input
                      id="margin"
                      type="number"
                      min="0"
                      step="any"
                      value={form.margin}
                      onChange={(e) => {
                        updateField("margin", e.target.value)
                        recalcSellPrice(Number(form.buyPrice), Number(e.target.value))
                      }}
                      placeholder="0"
                      className="w-20"
                    />
                  </div>
                  <span className="pb-2.5 text-base font-medium text-muted-foreground">=</span>
                  <div className="space-y-1.5">
                    <Label htmlFor="sellPrice" className="text-xs">{id.products.sellPrice} *</Label>
                    <Input
                      id="sellPrice"
                      type="number"
                      min="0"
                      value={form.sellPrice}
                      onChange={(e) => {
                        updateField("sellPrice", e.target.value)
                        recalcMargin(Number(form.buyPrice), Number(e.target.value))
                      }}
                      placeholder="0"
                    />
                  </div>
                </div>
                {(errors.buyPrice || errors.sellPrice) && (
                  <div className="mt-2 space-y-1">
                    {errors.buyPrice && <p className="text-xs font-medium text-destructive">{errors.buyPrice}</p>}
                    {errors.sellPrice && <p className="text-xs font-medium text-destructive">{errors.sellPrice}</p>}
                  </div>
                )}
                {actualMargin && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Margin aktual:</span>
                    <span className="font-semibold text-foreground">{actualMargin}%</span>
                    <span>
                      (Rp {(Number(form.sellPrice) - Number(form.buyPrice)).toLocaleString("id-ID")} / item)
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {id.common.cancel}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? id.common.loading : id.common.save}
            </Button>
          </DialogFooter>
        </form>
      </>
  )
}

function CategoryCombobox({
  categories,
  value,
  onValueChange,
}: {
  categories: { id: number; name: string }[]
  value: string
  onValueChange: (value: string) => void
}) {
  const selectedCategory = categories.find((c) => String(c.id) === value) ?? null

  return (
    <Combobox
      items={categories}
      itemToStringValue={(cat) => cat.name}
      value={selectedCategory}
      onValueChange={(cat) => onValueChange(cat ? String(cat.id) : "")}
    >
      <ComboboxInput placeholder="Pilih kategori..." showClear={!!value} />
      <ComboboxContent>
        <ComboboxEmpty>Kategori tidak ditemukan</ComboboxEmpty>
        <ComboboxList>
          {(cat) => (
            <ComboboxItem key={cat.id} value={cat}>
              {cat.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
