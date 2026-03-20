import { useState, useRef, useEffect, useCallback } from "react"
import { Search, Pin, Trash2, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
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
import { useQueryClient } from "@tanstack/react-query"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import type { PaginatedProducts, Product } from "@/features/products/types"
import { useCartStore } from "../hooks/use-cart-store"
import { getProductByBarcode } from "../hooks/use-cashier"
import { formatRupiah } from "../utils"

interface ShortcutProduct {
  id: number
  barcode: string | null
  sku: string | null
  name: string
  category_id: number | null
  buy_price: number
  sell_price: number
  margin: number
  stock: number
  unit: string
  min_stock: number | null
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  is_pinned: boolean
  select_count: number
}

export function ProductSearchPanel() {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [holdingPinId, setHoldingPinId] = useState<number | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const commandInputRef = useRef<HTMLDivElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdStartRef = useRef<number>(0)
  const addItem = useCartStore((s) => s.addItem)
  const queryClient = useQueryClient()

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

  const { data: shortcutProducts } = useTauriQuery<ShortcutProduct[]>(
    "get_popular_products",
    { limit: 100 }
  )

  const focusInput = useCallback(() => {
    setTimeout(() => {
      const input = commandInputRef.current?.querySelector("input")
      input?.focus()
    }, 50)
  }, [])

  const trackSelection = useCallback(async (productId: number) => {
    try {
      await invoke("track_product_selection", { productId })
      queryClient.invalidateQueries({ queryKey: ["get_popular_products"] })
    } catch {
      // Silent fail — tracking is non-critical
    }
  }, [queryClient])

  const handleTogglePin = useCallback(async (productId: number) => {
    try {
      const pinned = await invoke<boolean>("toggle_product_pin", { productId })
      toast.success(pinned ? "Produk di-pin" : "Pin dihapus")
      queryClient.invalidateQueries({ queryKey: ["get_popular_products"] })
    } catch {
      toast.error("Gagal mengubah pin")
    }
  }, [queryClient])

  const HOLD_DURATION = 500

  const startHoldUnpin = useCallback((e: React.PointerEvent, productId: number) => {
    e.stopPropagation()
    e.preventDefault()
    setHoldingPinId(productId)
    setHoldProgress(0)
    holdStartRef.current = Date.now()
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current
      const pct = Math.min((elapsed / HOLD_DURATION) * 100, 100)
      setHoldProgress(pct)
      if (elapsed >= HOLD_DURATION) {
        clearInterval(holdTimerRef.current!)
        holdTimerRef.current = null
        setHoldingPinId(null)
        setHoldProgress(0)
        handleTogglePin(productId)
      }
    }, 16)
  }, [handleTogglePin])

  const cancelHoldUnpin = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHoldingPinId(null)
    setHoldProgress(0)
  }, [])

  const addToCart = useCallback((product: Product | ShortcutProduct, isManualSearch: boolean) => {
    addItem(product)
    if (product.stock <= 0) {
      toast.warning(`Stok ${product.name} habis/minus, pastikan stok sudah diupdate`)
    }
    if (isManualSearch) {
      trackSelection(product.id)
    }
  }, [addItem, trackSelection])

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !searchQuery.trim()) return

    const query = searchQuery.trim()

    // Try barcode lookup first
    try {
      const product = await getProductByBarcode(query)
      if (product) {
        e.preventDefault()
        addToCart(product, false)
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
      addToCart(searchResults.data[0], true)
      setSearchQuery("")
      setDebouncedQuery("")
      focusInput()
      return
    }

    // Nothing found
    toast.error(`Produk "${query}" tidak ditemukan`)
    setSearchQuery("")
    setDebouncedQuery("")
    focusInput()
  }

  const handleProductSelect = (product: Product) => {
    addToCart(product, true)
    setSearchQuery("")
    setDebouncedQuery("")
    focusInput()
  }

  const handleShortcutSelect = (product: ShortcutProduct) => {
    addToCart(product, false)
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
              /* Shortcut Products */
              <div className="p-4">
                {shortcutProducts && shortcutProducts.length > 0 ? (
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <TrendingUp className="h-4 w-4" />
                      Produk Favorit
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {shortcutProducts.map((product) => {
                        const isHolding = holdingPinId === product.id
                        return (
                          <Button
                            key={product.id}
                            variant="outline"
                            className="group relative h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors"
                            style={isHolding ? {
                              borderColor: `color-mix(in srgb, var(--destructive) ${holdProgress}%, var(--border))`,
                              backgroundColor: `color-mix(in srgb, var(--destructive) ${holdProgress * 0.15}%, transparent)`,
                              boxShadow: `0 0 0 1px color-mix(in srgb, var(--destructive) ${holdProgress * 0.5}%, transparent)`,
                            } : undefined}
                            onClick={() => !isHolding && handleShortcutSelect(product)}
                          >
                            <span className="w-full truncate text-sm font-medium">
                              {product.name}
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {formatRupiah(product.sell_price)}
                            </span>
                            {product.is_pinned ? (
                              <div
                                role="button"
                                className="group/pin absolute bottom-1 right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-destructive/10"
                                onPointerDown={(e) => startHoldUnpin(e, product.id)}
                                onPointerUp={cancelHoldUnpin}
                                onPointerLeave={cancelHoldUnpin}
                                onClick={(e) => e.stopPropagation()}
                                title="Tahan untuk hapus pin"
                              >
                                {isHolding ? (
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                ) : (
                                  <>
                                    <Pin className="h-3 w-3 fill-current text-primary opacity-40 group-hover/pin:hidden" />
                                    <Trash2 className="hidden h-3 w-3 text-destructive group-hover/pin:block" />
                                  </>
                                )}
                              </div>
                            ) : (
                              <div
                                role="button"
                                className="absolute bottom-1 right-1 cursor-pointer rounded-full p-1 opacity-0 hover:bg-muted group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleTogglePin(product.id)
                                }}
                                title="Pin produk"
                              >
                                <Pin className="h-3 w-3 text-muted-foreground" />
                              </div>
                            )}
                          </Button>
                        )
                      })}
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
                        Scan barcode atau ketik nama produk. Produk yang sering dicari akan tampil di sini.
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
