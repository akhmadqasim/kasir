import { useState, useEffect, type ElementType } from "react"
import { Barcode, CircleMinus, ClipboardList, LayoutList, TrendingDown } from "lucide-react"
import { ToggleButton } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { useDebounce } from "@/hooks/use-debounce"
import { SearchInput } from "@/components/search-input"
import { id } from "@/i18n/id"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import { formatNumber } from "@/lib/format"
import { useCategories } from "../hooks/use-categories"
import type { ProductQuickFilter } from "../types"

/** Nilai sentinel `Select`: React Aria memakai `null` untuk "tidak ada pilihan". */
const ALL = "all"

interface ProductSearchProps {
  /** Jumlah produk yang cocok dengan filter; `undefined` selama belum dimuat. */
  total?: number
  onSearchChange: (query: string) => void
  onCategoryChange: (categoryId: number | null) => void
  quickFilter: ProductQuickFilter
  onQuickFilterChange: (filter: ProductQuickFilter) => void
}

/*
 * Satu ikon per filter: tiga filter pernah berbagi segitiga peringatan yang
 * sama, jadi ikonnya tidak membantu membedakan apa pun.
 */
const QUICK_FILTERS: Array<{
  value: ProductQuickFilter
  label: string
  icon: ElementType
}> = [
  { value: "all", label: "Semua", icon: LayoutList },
  { value: "low_stock", label: "Stok Rendah", icon: TrendingDown },
  { value: "negative_stock", label: "Stok Minus", icon: CircleMinus },
  { value: "no_barcode", label: "Tanpa Barcode", icon: Barcode },
  { value: "needs_review", label: "Perlu Review", icon: ClipboardList },
]

export function ProductSearch({
  total,
  onSearchChange,
  onCategoryChange,
  quickFilter,
  onQuickFilterChange,
}: ProductSearchProps) {
  const [searchInput, setSearchInput] = useState("")
  const [categoryKey, setCategoryKey] = useState<string>(ALL)
  const { data: categories } = useCategories()

  const debouncedSearch = useDebounce(searchInput, SEARCH_DEBOUNCE_MS)

  useEffect(() => {
    onSearchChange(debouncedSearch)
  }, [debouncedSearch, onSearchChange])

  const categoryOptions = [
    { key: ALL, label: id.products.allCategories },
    ...(categories ?? []).map((cat) => ({ key: String(cat.id), label: cat.name })),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          aria-label={id.products.search}
          className="w-full sm:max-w-sm sm:flex-1"
          placeholder={id.products.search}
          value={searchInput}
          onChange={setSearchInput}
        />

        <OptionSelect
          aria-label="Filter kategori"
          className="w-full sm:w-[200px]"
          options={categoryOptions}
          value={categoryKey}
          onChange={(value) => {
            const key = value ?? ALL
            setCategoryKey(key)
            onCategoryChange(key === ALL ? null : Number(key))
          }}
        />

        {/* Jumlah hasil: satu-satunya tempat kasir tahu berapa produk yang
            cocok tanpa menghitung halaman. `aria-live` supaya pembaca layar
            mendengar hasilnya berubah saat mengetik. */}
        {total != null && (
          <p aria-live="polite" className="text-sm text-muted tabular-nums sm:ml-auto">
            {formatNumber(total)} produk
          </p>
        )}
      </div>

      {/* Filter cepat. `ToggleButton` dipakai satu per satu, bukan lewat
          `ToggleButtonGroup`: grup menggabungkan kelimanya jadi satu titik Tab
          dengan navigasi panah, sedangkan di sini tiap tombol tetap punya titik
          Tab-nya sendiri seperti sebelumnya. Yang bertambah cuma `aria-pressed`;
          `role="group"` memberi kelimanya satu nama bersama. */}
      <div aria-label="Filter cepat" className="flex flex-wrap gap-2" role="group">
        {QUICK_FILTERS.map((filter) => {
          const Icon = filter.icon

          return (
            <ToggleButton
              key={filter.value}
              isSelected={quickFilter === filter.value}
              size="sm"
              // Filter ini saling meniadakan, jadi menekan yang sedang aktif
              // memilih ulang nilai yang sama alih-alih mematikannya.
              onChange={() => onQuickFilterChange(filter.value)}
            >
              <Icon />
              {filter.label}
            </ToggleButton>
          )
        })}
      </div>
    </div>
  )
}
