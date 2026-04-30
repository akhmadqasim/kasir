import { useState, useEffect, type ElementType } from "react"
import { AlertTriangle, Barcode, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { id } from "@/i18n/id"
import { useCategories } from "../hooks/use-categories"
import type { ProductQuickFilter } from "../types"

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
  const { data: categories } = useCategories()

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(searchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, onSearchChange])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={id.products.search}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          onValueChange={(value) => {
            onCategoryChange(value === "all" ? null : Number(value))
          }}
        >
          <SelectTrigger className="w-full lg:w-[200px]">
            <SelectValue placeholder={id.products.allCategories} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{id.products.allCategories}</SelectItem>
            {categories?.map((cat) => (
              <SelectItem key={cat.id} value={String(cat.id)}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => {
          const Icon = filter.icon
          const isActive = quickFilter === filter.value

          return (
            <Button
              key={filter.value}
              type="button"
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() => onQuickFilterChange(filter.value)}
            >
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {filter.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
