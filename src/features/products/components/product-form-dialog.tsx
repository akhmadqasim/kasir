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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { id } from "@/i18n/id"
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
  const { data: categories } = useCategories()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()

  const [name, setName] = useState("")
  const [barcode, setBarcode] = useState("")
  const [sku, setSku] = useState("")
  const [categoryId, setCategoryId] = useState<string>("")
  const [buyPrice, setBuyPrice] = useState("")
  const [sellPrice, setSellPrice] = useState("")
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
        setCategoryId(product.category_id ? String(product.category_id) : "")
        setBuyPrice(String(product.buy_price))
        setSellPrice(String(product.sell_price))
        setStock(String(product.stock))
        setUnit(product.unit)
        setMinStock(String(product.min_stock))
      } else {
        setName("")
        setBarcode("")
        setSku("")
        setCategoryId("")
        setBuyPrice("")
        setSellPrice("")
        setStock("")
        setUnit("pcs")
        setMinStock("")
      }
      setErrors({})
    }
  }, [open, product])

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
      stock: Number(stock),
      unit,
      min_stock: minStock ? Number(minStock) : 0,
    }

    if (isEditing && product) {
      const updateInput: UpdateProductInput = { ...input, id: product.id }
      updateProduct.mutate(
        { input: updateInput },
        { onSuccess: () => onOpenChange(false) }
      )
    } else {
      createProduct.mutate(
        { input },
        { onSuccess: () => onOpenChange(false) }
      )
    }
  }

  const isPending = createProduct.isPending || updateProduct.isPending

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
                onChange={(e) => setName(e.target.value)}
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
                <Label htmlFor="sku">{id.products.sku}</Label>
                <Input
                  id="sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder={id.products.sku}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{id.products.category}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={id.products.allCategories} />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="buyPrice">{id.products.buyPrice} *</Label>
                <Input
                  id="buyPrice"
                  type="number"
                  min="0"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="0"
                />
                {errors.buyPrice && <p className="text-sm text-destructive">{errors.buyPrice}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sellPrice">{id.products.sellPrice} *</Label>
                <Input
                  id="sellPrice"
                  type="number"
                  min="0"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  placeholder="0"
                />
                {errors.sellPrice && <p className="text-sm text-destructive">{errors.sellPrice}</p>}
              </div>
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
