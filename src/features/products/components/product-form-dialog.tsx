import { useState, useEffect } from "react"
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
  const isEditing = !!product
  const user = useAuthStore((s) => s.user)
  const { data: categories } = useCategories()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()

  const [name, setName] = useState("")
  const [barcode, setBarcode] = useState("")
  const [sku, setSku] = useState("")
  const [skuManual, setSkuManual] = useState(false)
  const [categoryId, setCategoryId] = useState<string>("")
  const [buyPrice, setBuyPrice] = useState("")
  const [sellPrice, setSellPrice] = useState("")
  const [margin, setMargin] = useState("")
  const [stock, setStock] = useState("")
  const [unit, setUnit] = useState("pcs")
  const [minStock, setMinStock] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      if (product) {
        setName(product.name)
        setBarcode(product.barcode || "")
        setSku(product.sku || "")
        setSkuManual(true)
        setCategoryId(product.category_id ? String(product.category_id) : "")
        setBuyPrice(String(product.buy_price))
        setSellPrice(String(product.sell_price))
        setMargin(product.margin ? String(product.margin) : "")
        // Recalculate margin from actual prices if not set
        if (!product.margin && product.buy_price > 0 && product.sell_price > 0) {
          const m = ((product.sell_price - product.buy_price) / product.buy_price) * 100
          setMargin(m % 1 === 0 ? String(m) : m.toFixed(2))
        }
        setStock(String(product.stock))
        setUnit(product.unit)
        setMinStock(String(product.min_stock))
      } else {
        setName("")
        setBarcode("")
        setSku("")
        setSkuManual(false)
        setCategoryId("")
        setBuyPrice("")
        setSellPrice("")
        setMargin("")
        setStock("")
        setUnit("pcs")
        setMinStock("")
      }
      setErrors({})
    }
  }, [open, product])

  const recalcSellPrice = (bp: number, m: number) => {
    if (bp > 0 && m > 0) {
      setSellPrice(String(Math.round(bp * (1 + m / 100))))
    }
  }

  const recalcMargin = (bp: number, sp: number) => {
    if (bp > 0 && sp > 0) {
      const m = ((sp - bp) / bp) * 100
      setMargin(m % 1 === 0 ? String(m) : m.toFixed(2))
    } else {
      setMargin("")
    }
  }

  const generateSku = (productName: string): string => {
    return productName.trim().replace(/\s+/g, "")
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = "Nama produk wajib diisi"
    if (!sellPrice || Number(sellPrice) <= 0) newErrors.sellPrice = "Harga jual harus lebih dari 0"
    if (!buyPrice || Number(buyPrice) < 0) newErrors.buyPrice = "Harga modal tidak valid"
    if (stock === "" || Number(stock) < 0) newErrors.stock = "Stok tidak boleh negatif"
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const input: CreateProductInput = {
      name: name.trim(),
      barcode: barcode.trim() || null,
      sku: sku.trim() || null,
      category_id: categoryId ? Number(categoryId) : null,
      buy_price: Number(buyPrice),
      sell_price: Number(sellPrice),
      margin: margin ? Number(margin) : 0,
      stock: Number(stock),
      unit,
      min_stock: minStock ? Number(minStock) : 0,
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
  const actualMargin = Number(buyPrice) > 0 && Number(sellPrice) > 0
    ? ((Number(sellPrice) - Number(buyPrice)) / Number(buyPrice) * 100).toFixed(1)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
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
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!skuManual) {
                    setSku(generateSku(e.target.value))
                  }
                }}
                placeholder={id.products.name}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="barcode">{id.products.barcode}</Label>
                <Input
                  id="barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder={id.products.barcode}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sku" className="flex items-center gap-1.5">
                  {id.products.sku}
                  {!skuManual && (
                    <span className="text-xs text-muted-foreground">(otomatis)</span>
                  )}
                </Label>
                <Input
                  id="sku"
                  value={sku}
                  onChange={(e) => {
                    setSku(e.target.value)
                    setSkuManual(true)
                  }}
                  placeholder="AUTO"
                  className={!skuManual ? "text-muted-foreground" : ""}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{id.products.category}</Label>
              <CategoryCombobox
                categories={categories ?? []}
                value={categoryId}
                onValueChange={setCategoryId}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stock">{id.products.stock} *</Label>
                <Input
                  id="stock"
                  type="number"
                  min="0"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="0"
                />
                {errors.stock && <p className="text-sm text-destructive">{errors.stock}</p>}
              </div>
              <div className="space-y-2">
                <Label>{id.products.unit} *</Label>
                <Select value={unit} onValueChange={setUnit}>
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
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
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
                      value={buyPrice}
                      onChange={(e) => {
                        setBuyPrice(e.target.value)
                        recalcSellPrice(Number(e.target.value), Number(margin))
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
                      value={margin}
                      onChange={(e) => {
                        setMargin(e.target.value)
                        recalcSellPrice(Number(buyPrice), Number(e.target.value))
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
                      value={sellPrice}
                      onChange={(e) => {
                        setSellPrice(e.target.value)
                        recalcMargin(Number(buyPrice), Number(e.target.value))
                      }}
                      placeholder="0"
                    />
                  </div>
                </div>
                {(errors.buyPrice || errors.sellPrice) && (
                  <div className="mt-2 space-y-1">
                    {errors.buyPrice && <p className="text-xs text-destructive">{errors.buyPrice}</p>}
                    {errors.sellPrice && <p className="text-xs text-destructive">{errors.sellPrice}</p>}
                  </div>
                )}
                {actualMargin && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Margin aktual:</span>
                    <span className="font-semibold text-foreground">{actualMargin}%</span>
                    <span>
                      (Rp {(Number(sellPrice) - Number(buyPrice)).toLocaleString("id-ID")} / item)
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
      </DialogContent>
    </Dialog>
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
