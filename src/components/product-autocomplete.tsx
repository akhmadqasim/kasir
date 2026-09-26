import { useMemo, useState, type ReactNode } from "react"
import {
  Autocomplete,
  Description,
  EmptyState,
  FieldError,
  Label,
  ListBox,
  SearchField,
  Spinner,
} from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { useDebounce } from "@/hooks/use-debounce"
import { useApiQuery } from "@/hooks/use-api"
import { searchProducts } from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import type { PaginatedProducts, Product, SearchProductsParams } from "@/features/products/types"
import { id } from "@/i18n/id"

/** Di bawah ini backend dipanggil untuk hampir seluruh katalog, jadi jangan. */
const MIN_QUERY_LENGTH = 2

interface ProductAutocompleteProps {
  label: string
  /** Teks pada pemicu saat belum ada produk terpilih. */
  placeholder: string
  searchPlaceholder: string
  /**
   * Produk yang sedang terpilih.
   *
   * Layar yang langsung memindahkan pilihan ke tempat lain — refund tukar barang
   * menaruhnya di daftar barang pengganti — selalu mengirim `null`, sehingga
   * pemicunya kembali kosong dan siap menerima produk berikutnya.
   */
  value: Product | null
  onSelect: (product: Product | null) => void
  /** Baris kedua tiap hasil: konteks yang dibutuhkan layar, misal stok dan harga. */
  renderDetail: (product: Product) => ReactNode
  perPage?: number
  isDisabled?: boolean
  /**
   * A product must be picked: the label gets its asterisk and the field
   * `aria-required`. Validation stays with the form (`validationBehavior="aria"`).
   */
  isRequired?: boolean
  errorMessage?: string
}

/**
 * Pencarian produk, satu untuk semua layar yang perlu memilih barang.
 *
 * Sebelumnya tiap layar merakit sendiri: sebuah `Input`, `div` absolut berisi
 * tombol-tombol hasil, dan penanganan klik-di-luar — masing-masing dengan bug
 * kecilnya sendiri (`setTimeout(…, 200)` pada `onBlur` di satu layar, listener
 * `mousedown` global di layar lain), dan tak satu pun bisa dinavigasi dengan
 * panah. `Autocomplete` HeroUI menggantinya: daftar hasilnya kini `ListBox`
 * React Aria, jadi panah atas/bawah, Escape dan pembacaan screen reader ikut
 * gratis.
 *
 * Penyaringan tetap di backend — `Autocomplete.Filter` sengaja tidak diberi
 * `filter`, jadi React Aria menampilkan apa adanya hasil `search_products`.
 */
export function ProductAutocomplete({
  label,
  placeholder,
  searchPlaceholder,
  value,
  onSelect,
  renderDetail,
  perPage = 10,
  isDisabled,
  isRequired,
  errorMessage,
}: ProductAutocompleteProps) {
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)
  const isSearching = debouncedQuery.trim().length >= MIN_QUERY_LENGTH

  const searchParams = useMemo<SearchProductsParams>(
    () => ({
      query: debouncedQuery,
      page: 1,
      per_page: perPage,
      sort_by: "name",
      sort_order: "asc",
    }),
    [debouncedQuery, perPage],
  )

  const { data, isFetching, isError } = useApiQuery<PaginatedProducts>(
    queryKeys.products.search(searchParams),
    () => searchProducts(searchParams),
    { enabled: isSearching },
  )

  /**
   * Produk terpilih ikut masuk daftar meski tidak ada di hasil pencarian terakhir.
   * Tanpa itu React Aria kehilangan kuncinya begitu kolom pencarian dikosongkan,
   * dan nama produk hilang dari pemicu.
   */
  const items = useMemo(() => {
    const results = isSearching ? (data?.data ?? []) : []
    if (!value) return results
    return [value, ...results.filter((product) => product.id !== value.id)]
  }, [data, isSearching, value])

  // While the debounce is still running, or the request is in flight, "Produk
  // tidak ditemukan" would be a lie told for 300 ms on every keystroke.
  const isWaiting =
    (query.trim().length >= MIN_QUERY_LENGTH && query !== debouncedQuery) ||
    (isSearching && isFetching && !data)

  const emptyText = isError
    ? `${id.products.searchFailed}. ${id.common.retry}.`
    : isSearching
      ? id.products.notFound
      : searchPlaceholder

  const handleChange = (key: unknown) => {
    const picked =
      key == null ? null : (items.find((product) => String(product.id) === String(key)) ?? null)
    onSelect(picked)
    setQuery("")
  }

  return (
    <Autocomplete
      allowsEmptyCollection
      fullWidth
      isDisabled={isDisabled}
      isInvalid={Boolean(errorMessage)}
      isRequired={isRequired}
      placeholder={placeholder}
      value={value ? String(value.id) : null}
      onChange={handleChange}
      onClear={() => {
        onSelect(null)
        setQuery("")
      }}
    >
      <Label>{label}</Label>
      <Autocomplete.Trigger>
        <Autocomplete.Value>{selectedText}</Autocomplete.Value>
        <Autocomplete.ClearButton aria-label="Hapus pilihan" />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover>
        <Autocomplete.Filter inputValue={query} onInputChange={setQuery}>
          <SearchField aria-label={searchPlaceholder} autoFocus>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={searchPlaceholder} />
            </SearchField.Group>
          </SearchField>
          {/* `EmptyState` dan `Description` per item: susunan yang dipakai
              dokumentasi Autocomplete sendiri untuk daftar kosong dan baris
              berketerangan. */}
          <ListBox
            aria-label={label}
            renderEmptyState={() =>
              isWaiting ? (
                <EmptyState className="flex items-center justify-center gap-2">
                  <Spinner size="sm" />
                  Mencari produk…
                </EmptyState>
              ) : (
                <EmptyState className={isError ? "text-danger" : undefined}>{emptyText}</EmptyState>
              )
            }
          >
            {items.map((product) => (
              <ListBox.Item key={product.id} id={String(product.id)} textValue={product.name}>
                <div className="flex flex-col">
                  <Label>{product.name}</Label>
                  <Description>{renderDetail(product)}</Description>
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
    </Autocomplete>
  )
}
