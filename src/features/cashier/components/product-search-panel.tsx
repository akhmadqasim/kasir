import { memo, useState, useRef, useEffect, useCallback, useId, useMemo } from "react"
import { InputGroup, Kbd, ScrollShadow, Separator, Tabs } from "@heroui/react"
import { Search, TrendingUp } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useApiQuery } from "@/hooks/use-api"
import {
  getPopularProducts,
  searchProducts,
  trackProductSelection,
} from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import type { PaginatedProducts, Product, ShortcutProduct } from "@/features/products/types"
import { useCartStore } from "@/stores/cart-store"
import { getProductByBarcode } from "../hooks/use-cashier"
import {
  getProductSearchEnterAction,
  isLikelyBarcodeScannerInput,
  isWholeBarcodeQuery,
  rankProductsForSearch,
} from "../search-behavior"
import { formatRupiah } from "../utils"
import { PpobQuickAccess } from "@/features/ppob"
import { ShortcutTile } from "./shortcut-tile"

/** How many shortcut tiles the cashier screen asks for. */
const SHORTCUT_LIMIT = 30

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
 *
 * `memo`: satu-satunya prop-nya `focusKey`, sedangkan `CashierPage` mengubah
 * state-nya setiap dialog dibuka atau ditutup — pembayaran, struk sukses, buka
 * kasir. Tanpa ini 30 ubin produk dirender ulang tepat saat dialog sukses
 * beranimasi masuk; dengan ini commit pembukaannya turun hampir separuh.
 */
export const ProductSearchPanel = memo(function ProductSearchPanel({
  focusKey = 0,
}: ProductSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [pickedProductValue, setPickedProductValue] = useState<string | undefined>()
  const searchInputRef = useRef<HTMLInputElement>(null)
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

  const searchParams = useMemo(() => ({ query: debouncedQuery, per_page: 50 }), [debouncedQuery])

  const { data: searchResults } = useApiQuery<PaginatedProducts>(
    queryKeys.products.search(searchParams),
    () => searchProducts(searchParams),
    { enabled: debouncedQuery.length > 0 },
  )

  const rankedSearchResults = useMemo(
    () => rankProductsForSearch(searchResults?.data ?? [], debouncedQuery),
    [searchResults?.data, debouncedQuery],
  )

  // Turunan, bukan state tersinkron: hasil pencarian yang berubah otomatis
  // memilih baris pertama kecuali kasir sudah memilih baris lain dengan panah.
  const selectedProductValue = useMemo(() => {
    if (rankedSearchResults.length === 0) return undefined

    const isPickedStillListed =
      pickedProductValue !== undefined &&
      rankedSearchResults.some((product) => String(product.id) === pickedProductValue)

    return isPickedStillListed ? pickedProductValue : String(rankedSearchResults[0].id)
  }, [pickedProductValue, rankedSearchResults])

  const activeProduct = useMemo(
    () => rankedSearchResults.find((product) => String(product.id) === selectedProductValue),
    [rankedSearchResults, selectedProductValue],
  )

  const { data: shortcutProducts } = useApiQuery<ShortcutProduct[]>(
    queryKeys.products.popular(SHORTCUT_LIMIT),
    () => getPopularProducts(SHORTCUT_LIMIT),
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
    const isContinuingFastInput = isSingleCharacterAppend && now - previousTiming.lastInputAt <= 50

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

  // Deliberately the narrowest key in the file. This fires on every item added
  // to the cart, and invalidating all of `["products"]` here would refetch the
  // search list on every scan.
  const trackSelection = useCallback(
    async (productId: number) => {
      try {
        await trackProductSelection(productId)
        queryClient.invalidateQueries({ queryKey: queryKeys.products.popularAll })
      } catch {
        // Silent fail — tracking is non-critical
      }
    },
    [queryClient],
  )

  const addToCart = useCallback(
    (product: Product | ShortcutProduct, isManualSearch: boolean) => {
      addItem(product)
      if (product.stock <= 0) {
        toast.warning(`Stok ${product.name} habis/minus, pastikan stok sudah diupdate`)
      }
      if (isManualSearch) {
        trackSelection(product.id)
      }
    },
    [addItem, trackSelection],
  )

  const handleProductSelect = (product: Product) => {
    addToCart(product, true)
    clearSearch()
    focusInput()
  }

  /** Panah memindahkan baris aktif; fokus tetap di kolom scan. */
  const moveActiveResult = (step: number) => {
    if (rankedSearchResults.length === 0) return
    const current = rankedSearchResults.findIndex(
      (product) => String(product.id) === selectedProductValue,
    )
    const next = Math.min(
      Math.max((current === -1 ? 0 : current) + step, 0),
      rankedSearchResults.length - 1,
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

      // A whole barcode that misses really is missing, so say so and clear the
      // field — leaving it filled would let the next scan land on the tail of
      // this one. A digit run of any other length may be the *tail* of a
      // barcode read off a worn label, which only the list search resolves;
      // toasting there would abort that search. The length test matters because
      // the timing heuristic fires on hand-typed input too: any pause over 50ms
      // restarts the window at the last keystroke.
      if (isLikelyScannerInput && isWholeBarcodeQuery(query)) {
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

  // `useCallback` supaya `ShortcutTile` yang ter-`memo` benar-benar melewatkan
  // render: identitas yang berubah tiap render akan membatalkan memo-nya.
  const handleShortcutSelect = useCallback(
    (product: ShortcutProduct) => {
      addToCart(product, false)
      focusInput()
    },
    [addToCart, focusInput],
  )

  const showSearchResults = debouncedQuery.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Search Bar */}
      <div className={cn("flex flex-col", showSearchResults ? "min-h-0 flex-1" : "h-auto")}>
        {/* Kolom scan tinggal di dalam panel `Surface`, jadi `variant="secondary"`;
            tinggi dan ukuran hurufnya bawaan HeroUI. */}
        <div className="p-4">
          <InputGroup fullWidth variant="secondary">
            <InputGroup.Prefix>
              <Search aria-hidden="true" className="size-4 text-muted" />
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
              placeholder="Scan barcode atau cari produk..."
              role="combobox"
              value={searchQuery}
              onChange={(e) => handleSearchQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {/* Contoh "Keyboard Shortcut" InputGroup: `Kbd` di suffix ber-`pe-2`. */}
            <InputGroup.Suffix className="pe-2">
              <Kbd>
                <Kbd.Abbr keyValue="enter" />
              </Kbd>
            </InputGroup.Suffix>
          </InputGroup>
        </div>

        {/* Search Results */}
        {showSearchResults && (
          <>
            <Separator />
            <ScrollShadow className="min-h-0 flex-1">
              {rankedSearchResults.length > 0 ? (
                <ul
                  aria-label="Hasil pencarian produk"
                  className="p-2"
                  id={listboxId}
                  role="listbox"
                >
                  {rankedSearchResults.map((product) => {
                    const isActive = String(product.id) === selectedProductValue
                    return (
                      // Bentuk barisnya mengikuti `.list-box-item` HeroUI — sudut
                      // `rounded-2xl`, hover `bg-default` — karena inilah listbox-nya.
                      <li
                        key={product.id}
                        aria-selected={isActive}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-sm",
                          isActive ? "bg-default text-default-foreground" : "hover:bg-default/60",
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
                          {/* Lencana hanya untuk stok habis; stok yang ada cuma angka — DESIGN.md §5.4. */}
                          {product.stock <= 0 ? (
                            <StatusBadge size="sm" status="error">
                              {product.stock} {product.unit}
                            </StatusBadge>
                          ) : (
                            <span className="text-xs tabular-nums text-muted">
                              {product.stock} {product.unit}
                            </span>
                          )}
                          <span className="min-w-20 text-right font-medium tabular-nums">
                            {formatRupiah(product.sell_price)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <NoData title="Produk tidak ditemukan" />
              )}
            </ScrollShadow>
          </>
        )}
      </div>

      {/* Tabs: Favorit / PPOB — only when not searching. Tabnya sudah di panel
          produk, jadi kata "Produk" tidak diulang di labelnya; tanpa ikon,
          seperti tab dashboard. */}
      {!showSearchResults && (
        <Tabs className="min-h-0 flex-1" defaultSelectedKey="produk">
          <Tabs.ListContainer className="mx-4 w-fit">
            <Tabs.List aria-label="Pintasan kasir">
              <Tabs.Tab id="produk">
                Favorit
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="ppob">
                PPOB
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* Panel mengisi sisa tinggi dan menggulung sendiri; jarak dan
              padding-nya diambil dari `p-4` di dalam supaya sama dengan kepala
              panel, bukan `mt-4 p-2` bawaan yang menambah 24px. */}
          <Tabs.Panel className="mt-0 min-h-0 flex-1 p-0" id="produk">
            <ScrollShadow className="h-full">
              <div className="p-4">
                {shortcutProducts && shortcutProducts.length > 0 ? (
                  // Kolomnya dihitung dari lebar panel, bukan dari breakpoint
                  // viewport: panel ini selebar sepertiga layar, jadi `lg:` yang
                  // menyala di layar 1400px memecahnya jadi empat kolom 91px dan
                  // setiap nama terpotong setelah tujuh huruf. `auto-fill` dengan
                  // lebar minimum menjamin ubin selalu cukup lebar untuk dibaca.
                  // `auto-rows-fr` menyamakan tingginya.
                  <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
                    {shortcutProducts.map((product) => (
                      <ShortcutTile
                        key={product.id}
                        product={product}
                        onSelect={handleShortcutSelect}
                      />
                    ))}
                  </div>
                ) : (
                  <NoData icon={<TrendingUp />} title="Produk yang sering dicari tampil di sini" />
                )}
              </div>
            </ScrollShadow>
          </Tabs.Panel>

          {/* Padding luar milik panel ini, bukan `PpobQuickAccess`: di halaman
              PPOB komponen yang sama berdiri langsung di atas kanvas yang sudah
              diberi padding `AppLayout`. */}
          <Tabs.Panel className="mt-0 min-h-0 flex-1 p-0" id="ppob">
            <ScrollShadow className="h-full">
              <div className="p-4">
                <PpobQuickAccess />
              </div>
            </ScrollShadow>
          </Tabs.Panel>
        </Tabs>
      )}
    </div>
  )
})
