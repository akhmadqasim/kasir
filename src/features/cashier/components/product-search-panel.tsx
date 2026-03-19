import { useState, useRef, useEffect, useCallback } from "react"
import { Search, TrendingUp } from "lucide-react"
import { toast } from "sonner"
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
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const commandInputRef = useRef<HTMLDivElement>(null)
  const addItem = useCartStore((s) => s.addItem)

  useEffect(() => {
    const input = commandInputRef.current?.querySelector("input")
    input?.focus()
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

  const focusInput = useCallback(() => {
    setTimeout(() => {
      const input = commandInputRef.current?.querySelector("input")
      input?.focus()
    }, 50)
  }, [])

  const addToCart = (product: Product) => {
    addItem(product)
    if (product.stock <= 0) {
      toast.warning(`Stok ${product.name} habis/minus, pastikan stok sudah diupdate`)
    }
  }

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !searchQuery.trim()) return

    // Try barcode lookup first
    try {
      const product = await getProductByBarcode(searchQuery.trim())
      if (product) {
        e.preventDefault()
        addToCart(product)
        setSearchQuery("")
        setDebouncedQuery("")
        focusInput()
        return
      }
    } catch {
      // Not a barcode, continue with search results
    }

    // If search results exist, select the first one
    if (searchResults?.data && searchResults.data.length > 0) {
      e.preventDefault()
      addToCart(searchResults.data[0])
      setSearchQuery("")
      setDebouncedQuery("")
      focusInput()
    }
  }

  const handleProductSelect = (product: Product) => {
    addToCart(product)
    setSearchQuery("")
    setDebouncedQuery("")
    focusInput()
  }

  const showSearchResults = debouncedQuery.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col overflow-hidden">
        <Command className="rounded-none border-none" shouldFilter={false}>
          <div className="relative" ref={commandInputRef}>
            <CommandInput
              placeholder="Scan barcode atau cari produk..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              onKeyDown={handleKeyDown}
              className="h-12 text-base"
            />
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <Kbd>Enter</Kbd>
            </div>
          </div>
          <CommandList className="max-h-none flex-1">
            {showSearchResults ? (
              searchResults?.data && searchResults.data.length > 0 ? (
                <CommandGroup>
                  {searchResults.data.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={String(product.id)}
                      onSelect={() => handleProductSelect(product)}
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
                        Scan barcode atau ketik nama produk
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
