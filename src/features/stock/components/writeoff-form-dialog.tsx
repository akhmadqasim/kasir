import { useState, useEffect, useRef } from "react"
import { Search, Package } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { useCreateWriteoff } from "../hooks/use-stock-writeoffs"
import type { Product, PaginatedProducts } from "@/features/products/types"

const REASONS = [
  { value: "damaged", label: "Rusak" },
  { value: "expired", label: "Kadaluarsa" },
  { value: "lost", label: "Hilang" },
  { value: "other", label: "Lainnya" },
] as const

interface WriteoffFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WriteoffFormDialog({ open, onOpenChange }: WriteoffFormDialogProps) {
  const user = useAuthStore((s) => s.user)
  const createWriteoff = useCreateWriteoff()

  // Product search
  const [productSearch, setProductSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Form fields
  const [quantity, setQuantity] = useState("")
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(productSearch)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [productSearch])

  // Search products
  const { data: searchData } = useTauriQuery<PaginatedProducts>(
    "search_products",
    { params: { query: debouncedSearch, per_page: 10, sort_by: "name", sort_order: "asc" } },
    { enabled: debouncedSearch.length >= 2 && !selectedProduct }
  )

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setProductSearch("")
      setDebouncedSearch("")
      setSelectedProduct(null)
      setShowResults(false)
      setQuantity("")
      setReason("")
      setNotes("")
      setErrors({})
    }
  }, [open])

  const lossValue = selectedProduct && quantity
    ? selectedProduct.buy_price * Number(quantity)
    : 0

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!selectedProduct) newErrors.product = "Pilih produk terlebih dahulu"
    if (!quantity || Number(quantity) <= 0) newErrors.quantity = "Jumlah harus lebih dari 0"
    if (selectedProduct && Number(quantity) > selectedProduct.stock) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate() || !selectedProduct) return

    createWriteoff.mutate(
      {
        input: {
          productId: selectedProduct.id,
          quantity: Number(quantity),
          reason,
          notes: notes.trim() || undefined,
        },
        callerId: user!.id,
      },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product)
    setProductSearch(product.name)
    setShowResults(false)
    setErrors((prev) => {
      const { product: _, ...rest } = prev
      return rest
    })
  }

  const handleSearchChange = (value: string) => {
    setProductSearch(value)
    setSelectedProduct(null)
    setShowResults(true)
  }

  const searchResults = searchData?.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Buat Write-off Baru</DialogTitle>
          <DialogDescription>
            Catat barang yang rusak, kadaluarsa, atau hilang dari stok.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            {/* Product Search */}
            <div className="space-y-2" ref={searchRef}>
              <Label>Produk *</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => {
                    if (debouncedSearch.length >= 2 && !selectedProduct) {
                      setShowResults(true)
                    }
                  }}
                  placeholder="Cari nama produk atau barcode..."
                  className="pl-9"
                />
                {showResults && debouncedSearch.length >= 2 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {searchResults.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Produk tidak ditemukan
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto py-1">
                        {searchResults.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => handleSelectProduct(product)}
                          >
                            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{product.name}</div>
                              <div className="text-xs text-muted-foreground">
                                Stok: {product.stock} {product.unit} · {formatRupiah(product.buy_price)} (modal)
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  <span className="font-medium">{selectedProduct.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    · Stok: {selectedProduct.stock} {selectedProduct.unit}
                    · Modal: {formatRupiah(selectedProduct.buy_price)}
                  </span>
                </div>
              )}
              {errors.product && <p className="text-sm text-destructive">{errors.product}</p>}
            </div>

            {/* Quantity & Reason */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantity">Jumlah *</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  max={selectedProduct?.stock ?? undefined}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
                {errors.quantity && <p className="text-sm text-destructive">{errors.quantity}</p>}
              </div>
              <div className="space-y-2">
                <Label>Alasan *</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih alasan" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl" position="popper" sideOffset={4}>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="rounded-lg">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.reason && <p className="text-sm text-destructive">{errors.reason}</p>}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Catatan</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan tambahan (opsional)..."
                rows={2}
              />
            </div>

            {/* Loss Value */}
            {lossValue > 0 && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-destructive">Estimasi Kerugian</span>
                  <span className="text-lg font-bold text-destructive">{formatRupiah(lossValue)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatRupiah(selectedProduct?.buy_price ?? 0)} × {quantity || 0} {selectedProduct?.unit}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {id.common.cancel}
            </Button>
            <Button type="submit" disabled={createWriteoff.isPending}>
              {createWriteoff.isPending ? id.common.loading : "Buat Write-off"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
