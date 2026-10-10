import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { KeyboardEvent, RefObject } from "react"
import { InputGroup, Kbd, ScrollShadow, Separator } from "@heroui/react"
import { Search } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { formatNumber } from "@/lib/format"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useApiQuery } from "@/hooks/use-api"
import { getProductByBarcode, searchProducts, trackProductSelection } from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import type { PaginatedProducts, Product, ShortcutProduct } from "@/features/products/types"
import { useCartStore } from "@/stores/cart-store"
import { id } from "@/i18n/id"
import { notePricedByLookup, priceChangeMessage } from "../cart-price-refresh"
import { useDeferredFocus } from "../hooks/use-deferred-focus"
import { useScanField } from "../hooks/use-scan-field"
import {
  getProductSearchEnterAction,
  isLikelyBarcodeScannerInput,
  isWholeBarcodeQuery,
  rankProductsForSearch,
  searchOptionId,
} from "../search-behavior"
import { CashierShortcutTabs } from "./cashier-shortcut-tabs"
import { ProductSearchResults } from "./product-search-results"

/** Result rows fetched per search. */
const SEARCH_PAGE_SIZE = 50

interface ProductSearchPanelProps {
  /**
   * The scan field's ref, owned by a parent that focuses it on request and
   * steers stray keystrokes into it. Without one the panel keeps its own.
   */
  inputRef?: RefObject<HTMLInputElement | null>
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
 * `memo`: its one prop is `inputRef`, a ref that never changes, while
 * `CashierPage` changes its state whenever a dialog opens or closes — payment,
 * the success receipt, opening the till. Without it, 30 product tiles re-render
 * just as the success dialog animates in; with it, that commit takes about
 * half as long.
 */
export const ProductSearchPanel = memo(function ProductSearchPanel({
  inputRef,
}: ProductSearchPanelProps) {
  const [pickedProductValue, setPickedProductValue] = useState<string | undefined>()
  const resetPicked = useCallback(() => setPickedProductValue(undefined), [])
  const {
    searchQuery,
    debouncedQuery,
    searchNow,
    handleSearchQueryChange,
    clearSearch,
    restoreQuery,
    readCurrentQuery,
    readInputTiming,
  } = useScanField(resetPicked)
  const ownInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = inputRef ?? ownInputRef
  const addItem = useCartStore((s) => s.addItem)
  const queryClient = useQueryClient()
  const listboxId = useId()

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [searchInputRef])

  const searchParams = useMemo(
    () => ({ query: debouncedQuery, per_page: SEARCH_PAGE_SIZE }),
    [debouncedQuery],
  )

  const {
    data: searchResults,
    isError: isSearchError,
    error: searchError,
    refetch: refetchSearch,
    isFetching: isSearchFetching,
  } = useApiQuery<PaginatedProducts>(
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

  const focusInput = useDeferredFocus(searchInputRef)

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
    (product: Product | ShortcutProduct, isManualSearch: boolean, fresh = false) => {
      // A line already in the cart takes the price only from a fresh barcode
      // lookup; tiles and search rows may be cached. A price that moved is
      // said the way the background repricing says it.
      const priceChange = addItem(product, { fresh })
      if (priceChange) {
        toast.warning(priceChangeMessage([priceChange]))
      }
      if (product.stock <= 0) {
        toast.warning(id.cashier.outOfStock(product.name))
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

  /**
   * Enter on a digit run: the exact barcode lookup first, the list search after.
   *
   * The field is emptied before the lookup is awaited, not after: a scan that
   * starts while the lookup is pending then types into an empty field and
   * stays a barcode of its own, instead of landing on the tail of this one
   * and being looked up as one long number that matches nothing.
   */
  const lookupBarcode = async (query: string) => {
    // Timed now: the field is about to be emptied, and the next scan may type
    // into it while the lookup is pending.
    const isLikelyScannerInput = isLikelyBarcodeScannerInput({
      submittedAt: Date.now(),
      ...readInputTiming(),
      query,
    })
    // Whether the list search already answered this exact query, as rendered
    // when Enter was pressed.
    const searchAnswered = debouncedQuery.trim() === query && searchResults !== undefined
    clearSearch()

    try {
      const product = await getProductByBarcode(query)
      if (product) {
        addToCart(product, false, true)
        // Only this fresh answer lets the background check skip the line;
        // search results and tiles may come from the query cache.
        notePricedByLookup(product.id, product.sell_price)
        focusInput()
        return
      }
    } catch {
      // Fall through to barcode not found feedback
    }

    // Only a whole barcode that misses is missing. Any other digit run may be
    // the tail of a worn label's barcode, which only the list search resolves.
    if (isLikelyScannerInput && isWholeBarcodeQuery(query)) {
      toast.error(id.cashier.barcodeNotFound(query))
      focusInput()
      return
    }

    // The list search gets the digits back in the field — unless the next
    // scan is already typing there, which wins.
    if (!searchAnswered && readCurrentQuery() === "") {
      restoreQuery(query)
      searchNow(query)
      focusInput()
      return
    }

    toast.error(id.cashier.barcodeNotFound(query))
    focusInput()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
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

    switch (enterAction) {
      case "ignore":
        return
      case "select-active-result":
        // Baris pertama aktif secara bawaan; panah atas/bawah bisa memindahkannya
        // sebelum Enter ditekan.
        e.preventDefault()
        if (activeProduct) handleProductSelect(activeProduct)
        return
      case "lookup-exact-barcode":
        e.preventDefault()
        e.stopPropagation()
        void lookupBarcode(query)
        return
      case "wait-for-search":
        e.preventDefault()
        searchNow(query)
        focusInput()
        return
      case "show-not-found":
        e.preventDefault()
        toast.error(id.cashier.productNotFound(query))
        clearSearch()
        focusInput()
    }
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
  // The first answer for this query has not arrived yet. Without this the
  // panel said "Produk tidak ditemukan" for the length of every request.
  const isSearchLoading = showSearchResults && searchResults === undefined && !isSearchError
  // Read out by screen readers as results change; the list itself is only
  // "pointed at" through `aria-activedescendant` and never takes focus.
  // Same precedence as the panel below: rows already on screen win over a
  // failed background refetch, so the announcement matches what is shown.
  const searchStatus = !showSearchResults
    ? ""
    : rankedSearchResults.length > 0
      ? `${formatNumber(rankedSearchResults.length)} produk ditemukan`
      : isSearchLoading
        ? "Mencari…"
        : isSearchError
          ? id.cashier.searchStatusFailed
          : id.products.notFound

  return (
    <div className="flex h-full flex-col">
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
                  ? searchOptionId(listboxId, Number(selectedProductValue))
                  : undefined
              }
              aria-autocomplete="list"
              // Only while the listbox is rendered: loading, error and "not
              // found" show no `ul`, and a dangling id points at nothing.
              aria-controls={
                showSearchResults && rankedSearchResults.length > 0 ? listboxId : undefined
              }
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
          <p aria-live="polite" className="sr-only" role="status">
            {searchStatus}
          </p>
        </div>

        {showSearchResults && (
          <>
            <Separator />
            <ScrollShadow className="min-h-0 flex-1">
              <ProductSearchResults
                activeValue={selectedProductValue}
                errorMessage={searchError?.message}
                isError={isSearchError}
                isLoading={isSearchLoading}
                isRetrying={isSearchFetching}
                listboxId={listboxId}
                products={rankedSearchResults}
                onRetry={() => refetchSearch()}
                onSelect={handleProductSelect}
              />
            </ScrollShadow>
          </>
        )}
      </div>

      {/* Favorit / PPOB — only when not searching. */}
      {!showSearchResults && <CashierShortcutTabs onSelectProduct={handleShortcutSelect} />}
    </div>
  )
})
