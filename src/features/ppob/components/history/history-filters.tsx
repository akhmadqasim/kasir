import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/date-range-picker"
import type { DateRange } from "@/lib/date-range"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PRODUCT_FILTER_OPTIONS, STATUS_FILTER_OPTIONS } from "./history-utils"

interface HistoryFiltersProps {
  productFilter: string
  statusFilter: string
  dateRange: DateRange | undefined
  onProductFilterChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
  onDateRangeChange: (range: DateRange | undefined) => void
}

export function HistoryFilters({
  productFilter,
  statusFilter,
  dateRange,
  onProductFilterChange,
  onStatusFilterChange,
  onDateRangeChange,
}: HistoryFiltersProps) {
  const hasFilters = productFilter !== "all" || statusFilter !== "all"

  const resetFilters = () => {
    onProductFilterChange("all")
    onStatusFilterChange("all")
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={productFilter} onValueChange={onProductFilterChange}>
        <SelectTrigger className="w-full max-w-48">
          <SelectValue placeholder="Semua Produk" />
        </SelectTrigger>
        <SelectContent>
          {PRODUCT_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-full max-w-48">
          <SelectValue placeholder="Semua Status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="mr-1 h-4 w-4" />
          Reset Filter
        </Button>
      )}

      <div className="ml-auto">
        <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
      </div>
    </div>
  )
}
