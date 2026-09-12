import { useState, useEffect, type ElementType } from "react"
import { AlertTriangle, Barcode, Search } from "lucide-react"
import { ToggleButton } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { SearchInput } from "@/components/search-input"
import { id } from "@/i18n/id"
import { useCategories } from "../hooks/use-categories"
import type { ProductQuickFilter } from "../types"

/** Nilai sentinel `Select`: React Aria memakai `null` untuk "tidak ada pilihan". */
const ALL = "all"

interface ProductSearchProps {
  onSearchChange: (query: string) => void
  onCategoryChange: (categoryId: number | null) => void
  quickFilter: ProductQuickFilter
  onQuickFilterChange: (filter: ProductQuickFilter) => void
}

const QUICK_FILTERS: Array<{
  value: ProductQuickFilter
  label: string
  icon: ElementType
}> = [
  { value: "all", label: "Semua", icon: Search },
  { value: "low_stock", label: "Stok Rendah", icon: AlertTriangle },
  { value: "negative_stock", label: "Stok Minus", icon: AlertTriangle },
  { value: "no_barcode", label: "Tanpa Barcode", icon: Barcode },
  { value: "needs_review", label: "Perlu Review", icon: AlertTriangle },
]

export function ProductSearch({
  onSearchChange,
  onCategoryChange,
  quickFilter,
  onQuickFilterChange,
}: ProductSearchProps) {
  const [searchInput, setSearchInput] = useState("")
  const [categoryKey, setCategoryKey] = useState<string>(ALL)
  const { data: categories } = useCategories()

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(searchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, onSearchChange])

  const categoryOptions = [
    { key: ALL, label: id.products.allCategories },
    ...(categories ?? []).map((cat) => ({ key: String(cat.id), label: cat.name })),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          aria-label={id.products.search}
          className="max-w-sm flex-1"
          placeholder={id.products.search}
          value={searchInput}
          onChange={setSearchInput}
        />

        <OptionSelect
          aria-label={id.products.allCategories}
          className="w-full lg:w-[200px]"
          options={categoryOptions}
          value={categoryKey}
          onChange={(value) => {
            const key = value ?? ALL
            setCategoryKey(key)
            onCategoryChange(key === ALL ? null : Number(key))
          }}
        />
      </div>

      {/* Filter cepat. `ToggleButton` dipakai satu per satu, bukan lewat
          `ToggleButtonGroup`: grup menggabungkan kelimanya jadi satu titik Tab
          dengan navigasi panah, sedangkan di sini tiap tombol tetap punya titik
          Tab-nya sendiri seperti sebelumnya. Yang bertambah cuma `aria-pressed`. */}
      <div className="flex flex-wrap gap-2">
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
