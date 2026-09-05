import { useState, useRef, useEffect, useCallback, useId, useMemo } from "react"
import { Button, InputGroup, Kbd, ScrollShadow, Tabs } from "@heroui/react"
import { Search, Pin, Trash2, TrendingUp, Smartphone } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { useQueryClient } from "@tanstack/react-query"

import { StatusBadge } from "@/components/status-badge"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useTauriQuery } from "@/hooks/use-tauri-command"
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

/**
 * Kolom scan + daftar hasil, dirakit sendiri dari `input` dan
 * `ul[role="listbox"]`, bukan dari `Autocomplete` atau `ComboBox` HeroUI.
 *
 * Dua alasan, keduanya soal alur kasir:
 *
 *  - `Autocomplete` menyembunyikan kolom pencariannya di dalam popover yang baru
 *    terbuka setelah pemicunya ditekan. Scanner barcode adalah keyboard: ia
 *    mengetik ke kolom yang *sedang* fokus dan menutupnya dengan Enter, jadi
 *    kolomnya harus selalu ada dan selalu bisa difokuskan.
 *  - `ComboBox` menyimpan pilihan sebagai `selectedKey`. Memilih produk yang sama
 *    dua kali berturut-turut tidak mengubah kunci itu, jadi pemilihan keduanya
 *    tidak terkirim — padahal men-scan barang yang sama dua kali adalah hal
 *    paling biasa di kasir.
 *
 * Yang tersisa dari pola combobox tetap ditulis tangan di sini: `role="combobox"`
 * pada kolomnya, `aria-activedescendant` yang menunjuk baris aktif, dan panah
 * atas/bawah yang memindahkan baris aktif tanpa memindahkan fokus. Persis yang
 * dulu dikerjakan `cmdk`.
 */
export function ProductSearchPanel({ focusKey = 0 }: ProductSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [pickedProductValue, setPickedProductValue] = useState<string | undefined>()
  const [holdingPinId, setHoldingPinId] = useState<number | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdStartRef = useRef<number>(0)
  const searchQueryRef = useRef("")
  const inputTimingRef = useRef({ query: "", startedAt: 0, lastInputAt: 0 })
  const addItem = useCartStore((s) => s.addItem)
  const queryClient = useQueryClient()
  const listboxId = useId()
  const optionId = (productId: number) => `${listboxId}-option-${productId}`

  useEffect(() => {
    searchInputRef.current?.focus()
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

  const activeProduct = useMemo(
    () =>
      rankedSearchResults.find(
        (product) => String(product.id) === selectedProductValue
      ),
    [rankedSearchResults, selectedProductValue]
  )

  const { data: shortcutProducts } = useTauriQuery<ShortcutProduct[]>(
    "get_popular_products",
    { limit: 30 }
  )

  const focusInput = useCallback(() => {
    setTimeout(() => {
      searchInputRef.current?.focus()
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

  const handleProductSelect = (product: Product) => {
    addToCart(product, true)
    clearSearch()
    focusInput()
  }

  /** Panah memindahkan baris aktif; fokus tetap di kolom scan. */
  const moveActiveResult = (step: number) => {
    if (rankedSearchResults.length === 0) return
    const current = rankedSearchResults.findIndex(
      (product) => String(product.id) === selectedProductValue
    )
    const next = Math.min(
      Math.max((current === -1 ? 0 : current) + step, 0),
      rankedSearchResults.length - 1
    )
    setPickedProductValue(String(rankedSearchResults[next].id))
  }

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!showSearchResults) return
      e.preventDefault()
      moveActiveResult(e.key === "ArrowDown" ? 1 : -1)
      return
    }

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
      // Baris pertama aktif secara bawaan; panah atas/bawah bisa memindahkannya
      // sebelum Enter ditekan.
      e.preventDefault()
      if (activeProduct) handleProductSelect(activeProduct)
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

  const handleShortcutSelect = (product: ShortcutProduct) => {
    addToCart(product, false)
    focusInput()
  }

  const showSearchResults = debouncedQuery.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Search Bar */}
      <div
        className={cn(
          "flex flex-col border-b",
          showSearchResults ? "min-h-0 flex-1" : "h-auto"
        )}
      >
        <InputGroup className="rounded-none border-0 border-b shadow-none">
          <InputGroup.Prefix>
            <Search className="h-4 w-4 text-muted" />
          </InputGroup.Prefix>
          <InputGroup.Input
            ref={searchInputRef}
            aria-activedescendant={
              showSearchResults && selectedProductValue !== undefined
                ? optionId(Number(selectedProductValue))
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={showSearchResults}
            aria-label="Scan barcode atau cari produk"
            autoComplete="off"
            className="h-14 text-lg"
            placeholder="Scan barcode atau cari produk..."
            role="combobox"
            value={searchQuery}
            onChange={(e) => handleSearchQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <InputGroup.Suffix className="pe-3">
            <Kbd>
              <Kbd.Content>Enter</Kbd.Content>
            </Kbd>
          </InputGroup.Suffix>
        </InputGroup>

        {showSearchResults && activeProduct && (
          <div className="border-t px-4 py-2 text-xs text-muted">
            Enter akan pilih item aktif:{" "}
            <span className="font-medium text-foreground">{activeProduct.name}</span>{" "}
            <span className="tabular-nums">
              ({formatRupiah(activeProduct.sell_price)})
            </span>
          </div>
        )}

        {/* Search Results */}
        {showSearchResults && (
          <ScrollShadow className="min-h-0 flex-1">
            {rankedSearchResults.length > 0 ? (
              <ul
                aria-label="Hasil pencarian produk"
                className="p-1"
                id={listboxId}
                role="listbox"
              >
                {rankedSearchResults.map((product) => {
                  const isActive = String(product.id) === selectedProductValue
                  return (
                    <li
                      key={product.id}
                      aria-selected={isActive}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                        isActive ? "bg-default text-default-foreground" : "hover:bg-default/60"
                      )}
                      id={optionId(product.id)}
                      role="option"
                      onPointerDown={(e) => {
                        // Jangan sampai kolom scan kehilangan fokus sebelum
                        // produknya masuk keranjang.
                        e.preventDefault()
                        handleProductSelect(product)
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{product.name}</p>
                        {product.barcode && (
                          <p className="font-mono text-xs text-muted">{product.barcode}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          size="sm"
                          status={product.stock <= 0 ? "error" : "neutral"}
                        >
                          {product.stock} {product.unit}
                        </StatusBadge>
                        <span className="min-w-[80px] text-right font-semibold tabular-nums">
                          {formatRupiah(product.sell_price)}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted">
                Produk tidak ditemukan
              </p>
            )}
          </ScrollShadow>
        )}
      </div>

      {/* Tabs: Produk Favorit / PPOB — only when not searching */}
      {!showSearchResults && (
        <Tabs className="flex min-h-0 flex-1 flex-col" defaultSelectedKey="produk">
          <Tabs.ListContainer className="mx-4 mt-2 w-auto self-start">
            <Tabs.List aria-label="Pintasan kasir">
              <Tabs.Tab className="gap-1.5" id="produk">
                <TrendingUp className="h-3.5 w-3.5" />
                Produk Favorit
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab className="gap-1.5" id="ppob">
                <Smartphone className="h-3.5 w-3.5" />
                PPOB
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel className="mt-0 min-h-0 flex-1" id="produk">
            <ScrollShadow className="h-full">
              <div className="p-4">
                {shortcutProducts && shortcutProducts.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {shortcutProducts.map((product) => {
                      const isHolding = holdingPinId === product.id
                      return (
                        <Button
                          key={product.id}
                          className="group relative h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors"
                          style={isHolding ? {
                            borderColor: `color-mix(in srgb, var(--danger) ${holdProgress}%, var(--border))`,
                            backgroundColor: `color-mix(in srgb, var(--danger) ${holdProgress * 0.15}%, transparent)`,
                            boxShadow: `0 0 0 1px color-mix(in srgb, var(--danger) ${holdProgress * 0.5}%, transparent)`,
                          } : undefined}
                          variant="outline"
                          onPress={() => !isHolding && handleShortcutSelect(product)}
                        >
                          <span className="w-full truncate text-sm font-medium">
                            {product.name}
                          </span>
                          <span className="text-xs tabular-nums text-muted">
                            {formatRupiah(product.sell_price)}
                          </span>
                          {product.is_pinned ? (
                            <span
                              aria-label="Tahan untuk hapus pin"
                              role="button"
                              className="group/pin absolute bottom-1 right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-danger/10"
                              onPointerDown={(e) => startHoldUnpin(e, product.id)}
                              onPointerUp={cancelHoldUnpin}
                              onPointerLeave={cancelHoldUnpin}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isHolding ? (
                                <Trash2 className="h-3 w-3 text-danger" />
                              ) : (
                                <>
                                  <Pin className="h-3 w-3 fill-current text-accent opacity-40 group-hover/pin:hidden" />
                                  <Trash2 className="hidden h-3 w-3 text-danger group-hover/pin:block" />
                                </>
                              )}
                            </span>
                          ) : (
                            <span
                              aria-label="Pin produk"
                              role="button"
                              className="absolute bottom-1 right-1 cursor-pointer rounded-full p-1 opacity-0 hover:bg-default group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleTogglePin(product.id)
                              }}
                            >
                              <Pin className="h-3 w-3 text-muted" />
                            </span>
                          )}
                        </Button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Search className="h-10 w-10 text-muted" />
                    <p className="font-medium">Cari Produk</p>
                    <p className="max-w-sm text-sm text-muted">
                      Scan barcode, ketik nama produk, atau ketik sebagian barcode.
                      Produk yang sering dicari akan tampil di sini.
                    </p>
                  </div>
                )}
              </div>
            </ScrollShadow>
          </Tabs.Panel>

          <Tabs.Panel className="mt-0 min-h-0 flex-1" id="ppob">
            <ScrollShadow className="h-full">
              <PpobQuickAccess />
            </ScrollShadow>
          </Tabs.Panel>
        </Tabs>
      )}
    </div>
  )
}
