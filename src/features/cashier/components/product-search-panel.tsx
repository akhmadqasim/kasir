import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Search, Pin, Trash2, TrendingUp, Smartphone } from "lucide-react"
import { toast } from "@/lib/toast"
import { invoke } from "@tauri-apps/api/core"
import { cn } from "@/lib/utils"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { useQueryClient } from "@tanstack/react-query"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import type { PaginatedProducts, Product } from "@/features/products/types"
import { useCartStore } from "../hooks/use-cart-store"
import { getProductByBarcode } from "../hooks/use-cashier"
import {
  getProductSearchEnterAction,
  isLikelyBarcodeScannerInput,
  rankProductsForSearch,
} from "../search-behavior"
import { formatRupiah } from "../utils"
import { PpobQuickAccess } from "./ppob-quick-access"

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

interface ProductSearchPanelProps {
  focusKey?: number
}

export function ProductSearchPanel({ focusKey = 0 }: ProductSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [pickedProductValue, setPickedProductValue] = useState<string | undefined>()
  const [holdingPinId, setHoldingPinId] = useState<number | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const commandInputRef = useRef<HTMLDivElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdStartRef = useRef<number>(0)
  const searchQueryRef = useRef("")
  const inputTimingRef = useRef({ query: "", startedAt: 0, lastInputAt: 0 })
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
    { params: { query: debouncedQuery, per_page: 50 } },
    { enabled: debouncedQuery.length > 0 }
  )

  const rankedSearchResults = useMemo(
    () => rankProductsForSearch(searchResults?.data ?? [], debouncedQuery),
    [searchResults?.data, debouncedQuery]
  )

  // Turunan, bukan state tersinkron: hasil pencarian yang berubah otomatis
  // memilih baris pertama kecuali kasir sudah memilih baris lain dengan panah.
  const selectedProductValue = useMemo(() => {
    if (rankedSearchResults.length === 0) return undefined

    const isPickedStillListed =
      pickedProductValue !== undefined &&
      rankedSearchResults.some((product) => String(product.id) === pickedProductValue)

    return isPickedStillListed
      ? pickedProductValue
      : String(rankedSearchResults[0].id)
  }, [pickedProductValue, rankedSearchResults])

  const { data: shortcutProducts } = useTauriQuery<ShortcutProduct[]>(
    "get_popular_products",
    { limit: 30 }
  )

  const focusInput = useCallback(() => {
    setTimeout(() => {
      const input = commandInputRef.current?.querySelector("input")
      input?.focus()
    }, 50)
  }, [])

  const resetSearchInputTiming = useCallback(() => {
    searchQueryRef.current = ""
    inputTimingRef.current = { query: "", startedAt: 0, lastInputAt: 0 }
  }, [])

  const clearSearch = useCallback(() => {
    resetSearchInputTiming()
    setSearchQuery("")
    setDebouncedQuery("")
    setPickedProductValue(undefined)
  }, [resetSearchInputTiming])

  const handleSearchQueryChange = useCallback((value: string) => {
    const now = Date.now()
    const previousValue = searchQueryRef.current
    const previousTiming = inputTimingRef.current
    const isSingleCharacterAppend =
      value.length === previousValue.length + 1 && value.startsWith(previousValue)
    const isContinuingFastInput =
      isSingleCharacterAppend && now - previousTiming.lastInputAt <= 50

    searchQueryRef.current = value

    if (!value) {
      inputTimingRef.current = { query: "", startedAt: 0, lastInputAt: 0 }
    } else if (isContinuingFastInput) {
      inputTimingRef.current = {
        query: value,
        startedAt: previousTiming.startedAt,
        lastInputAt: now,
      }
    } else {
      inputTimingRef.current = { query: value, startedAt: now, lastInputAt: now }
    }

    setSearchQuery(value)
  }, [])

  useEffect(() => {
    if (focusKey === 0) return
    focusInput()
  }, [focusKey, focusInput])

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
    if (e.key !== "Enter") return

    const query = searchQuery.trim()
    if (!query) return

    const enterAction = getProductSearchEnterAction({
      query,
      debouncedQuery,
      resultCount: rankedSearchResults.length,
      hasSearchData: searchResults !== undefined,
    })

    if (enterAction === "ignore") return

    if (enterAction === "select-active-result") {
      // Let cmdk select the controlled active item. The first result is active by
      // default, but ArrowUp/ArrowDown can move the selection before Enter.
      return
    }

    if (enterAction === "lookup-exact-barcode") {
      e.preventDefault()
      e.stopPropagation()

      try {
        const product = await getProductByBarcode(query)
        if (product) {
          addToCart(product, false)
          clearSearch()
          focusInput()
          return
        }
      } catch {
        // Fall through to barcode not found feedback
      }

      const isLikelyScannerInput = isLikelyBarcodeScannerInput({
        submittedAt: Date.now(),
        ...inputTimingRef.current,
        query,
      })

      if (isLikelyScannerInput) {
        toast.error(`Barcode "${query}" tidak ditemukan`)
        clearSearch()
        focusInput()
        return
      }

      if (debouncedQuery.trim() !== query || searchResults === undefined) {
        setDebouncedQuery(query)
        focusInput()
        return
      }

      toast.error(`Barcode "${query}" tidak ditemukan`)
      clearSearch()
      focusInput()
      return
    }

    if (enterAction === "wait-for-search") {
      e.preventDefault()
      setDebouncedQuery(query)
      focusInput()
      return
    }

    e.preventDefault()
    toast.error(`Produk "${query}" tidak ditemukan`)
    clearSearch()
    focusInput()
  }

  const handleProductSelect = (product: Product) => {
    addToCart(product, true)
    clearSearch()
    focusInput()
  }

  const handleShortcutSelect = (product: ShortcutProduct) => {
    addToCart(product, false)
    focusInput()
  }

  const showSearchResults = debouncedQuery.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Search Bar */}
      <Command
        className={cn("rounded-none border-none border-b", showSearchResults ? "min-h-0 flex-1" : "h-auto")}
        shouldFilter={false}
        value={selectedProductValue}
        onValueChange={setPickedProductValue}
      >
        <div className="relative" ref={commandInputRef}>
          <CommandInput
            placeholder="Scan barcode atau cari produk..."
            value={searchQuery}
            onValueChange={handleSearchQueryChange}
            onKeyDown={handleKeyDown}
            className="h-14 text-lg"
          />
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            <Kbd>Enter</Kbd>
          </div>
        </div>

        {showSearchResults && rankedSearchResults[0] && (
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            Enter akan pilih item aktif:{" "}
            <span className="font-medium text-foreground">{rankedSearchResults[0].name}</span>{" "}
            <span className="tabular-nums">({formatRupiah(rankedSearchResults[0].sell_price)})</span>
          </div>
        )}

        {/* Search Results */}
        {showSearchResults && (
          <CommandList className="max-h-none flex-1">
            {rankedSearchResults.length > 0 ? (
              <CommandGroup>
                {rankedSearchResults.map((product) => (
                  <CommandItem
                    key={product.id}
                    value={String(product.id)}
                    onSelect={() => handleProductSelect(product)}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{product.name}</p>
                      {product.barcode && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {product.barcode}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={product.stock <= 0 ? "destructive" : "secondary"}
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
            )}
          </CommandList>
        )}
      </Command>

      {/* Tabs: Produk Favorit / PPOB — only when not searching */}
      {!showSearchResults && (
        <Tabs defaultValue="produk" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-2 w-auto self-start">
            <TabsTrigger value="produk" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Produk Favorit
            </TabsTrigger>
            <TabsTrigger value="ppob" className="gap-1.5">
              <Smartphone className="h-3.5 w-3.5" />
              PPOB
            </TabsTrigger>
          </TabsList>

          <TabsContent value="produk" className="mt-0 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-4">
                {shortcutProducts && shortcutProducts.length > 0 ? (
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
                              className="absolute bottom-1 right-1 cursor-pointer rounded-full p-1 opacity-0 hover:bg-default group-hover:opacity-100"
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
                ) : (
                  <Empty className="border-none">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Search />
                      </EmptyMedia>
                      <EmptyTitle>Cari Produk</EmptyTitle>
                      <EmptyDescription>
                        Scan barcode, ketik nama produk, atau ketik sebagian barcode. Produk yang sering dicari akan tampil di sini.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="ppob" className="mt-0 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <PpobQuickAccess />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
