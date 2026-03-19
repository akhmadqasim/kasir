import { useState, useRef, useEffect, useCallback } from "react"
import { Search, Barcode, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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

  useEffect(() => {
    barcodeInputRef.current?.focus()
  }, [])

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

  const { data: popularProducts } = useTauriQuery<Product[]>(
    "get_popular_products",
    { limit: 8 }
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

  const handleProductSelect = (product: Product) => {
    if (product.stock <= 0) {
      toast.error("Stok tidak cukup")
      return
    }
    addItem(product)
    focusBarcodeInput()
  }

  const showSearchResults = debouncedQuery.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Barcode Input — larger */}
      <div className="px-4 py-4">
        <InputGroup className="h-12 text-lg">
          <InputGroupAddon>
            <Barcode className="h-5 w-5" />
          </InputGroupAddon>
          <InputGroupInput
            ref={barcodeInputRef}
            className="text-lg"
            placeholder="Scan atau ketik barcode..."
            value={barcodeValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBarcodeValue(e.target.value)}
            onKeyDown={handleBarcodeSubmit}
          />
          <InputGroupAddon align="inline-end">
            <Kbd>Enter</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <Separator />

      {/* Product Search with Command */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Command className="rounded-none border-none" shouldFilter={false}>
          <CommandInput
            placeholder="Cari produk..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="max-h-none flex-1">
            {showSearchResults ? (
              searchResults?.data && searchResults.data.length > 0 ? (
                <CommandGroup>
                  {searchResults.data.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={String(product.id)}
                      onSelect={() => handleProductSelect(product)}
                      disabled={product.stock <= 0}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {product.name}
                        </p>
                        {product.barcode && (
                          <p className="font-mono text-xs text-muted-foreground">
                            {product.barcode}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            product.stock <= 0 ? "destructive" : "secondary"
                          }
                          className="text-xs"
                        >
                          {product.stock} {product.unit}
                        </Badge>
                        <span className="min-w-[80px] text-right font-semibold tabular-nums">
                          {formatRupiah(product.sell_price)}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <CommandEmpty>Produk tidak ditemukan</CommandEmpty>
              )
            ) : (
              /* Popular Products Shortcuts */
              <div className="p-4">
                {popularProducts && popularProducts.length > 0 ? (
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <TrendingUp className="h-4 w-4" />
                      Produk Terlaris
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {popularProducts.map((product) => (
                        <Button
                          key={product.id}
                          variant="outline"
                          className="h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left"
                          onClick={() => handleProductSelect(product)}
                          disabled={product.stock <= 0}
                        >
                          <span className="w-full truncate text-sm font-medium">
                            {product.name}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatRupiah(product.sell_price)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Empty className="border-none">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Search />
                      </EmptyMedia>
                      <EmptyTitle>Cari Produk</EmptyTitle>
                      <EmptyDescription>
                        Ketik nama produk atau scan barcode
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  )
}
