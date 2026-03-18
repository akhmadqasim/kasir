import { useState, useRef, useEffect, useCallback } from "react"
import { Search, Barcode } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import type { PaginatedProducts, Product } from "@/features/products/types"
import { useCartStore } from "../hooks/use-cart-store"
import { getProductByBarcode } from "../hooks/use-cashier"
import { formatRupiah } from "../utils"

export function ProductSearchPanel() {
  const [barcodeValue, setBarcodeValue] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const addItem = useCartStore((s) => s.addItem)

  // Auto-focus barcode input on mount
  useEffect(() => {
    barcodeInputRef.current?.focus()
  }, [])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: searchResults } = useTauriQuery<PaginatedProducts>(
    "search_products",
    { params: { query: debouncedQuery, per_page: 20 } },
    { enabled: debouncedQuery.length > 0 }
  )

  const focusBarcodeInput = useCallback(() => {
    setTimeout(() => barcodeInputRef.current?.focus(), 50)
  }, [])

  const handleBarcodeSubmit = async (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !barcodeValue.trim()) return

    try {
      const product = await getProductByBarcode(barcodeValue.trim())
      if (product) {
        if (product.stock <= 0) {
          toast.error("Stok tidak cukup")
        } else {
          addItem(product)
        }
      } else {
        toast.error("Produk tidak ditemukan")
      }
    } catch {
      toast.error("Gagal mencari produk")
    }

    setBarcodeValue("")
    focusBarcodeInput()
  }

  const handleProductClick = (product: Product) => {
    if (product.stock <= 0) {
      toast.error("Stok tidak cukup")
      return
    }
    addItem(product)
    focusBarcodeInput()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Barcode Input */}
      <div className="p-4 pb-2">
        <div className="relative">
          <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={barcodeInputRef}
            className="h-12 pl-10 text-lg"
            placeholder="Scan atau ketik barcode..."
            value={barcodeValue}
            onChange={(e) => setBarcodeValue(e.target.value)}
            onKeyDown={handleBarcodeSubmit}
          />
        </div>
      </div>

      <Separator />

      {/* Product Search */}
      <div className="p-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder="Cari produk..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Search Results */}
      <ScrollArea className="flex-1 px-4 pb-4">
        {debouncedQuery.length > 0 && searchResults?.data ? (
          searchResults.data.length > 0 ? (
            <div className="flex flex-col gap-1">
              {searchResults.data.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
                  onClick={() => handleProductClick(product)}
                  disabled={product.stock <= 0}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.name}</p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {product.barcode && (
                        <span className="font-mono text-xs">
                          {product.barcode}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">
                      {formatRupiah(product.sell_price)}
                    </p>
                    <Badge
                      variant={product.stock <= 0 ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      Stok: {product.stock} {product.unit}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Produk tidak ditemukan
            </div>
          )
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <Search className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">Ketik nama produk untuk mencari</p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
