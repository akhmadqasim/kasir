import { Button } from "@heroui/react"
import { X } from "lucide-react"

import { DateRangePicker } from "@/components/date-range-picker"
import { OptionSelect } from "@/components/option-select"
import type { DateRange } from "@/lib/date-range"
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
    <div className="flex flex-wrap items-center gap-2">
      <OptionSelect
        aria-label="Filter produk"
        className="w-full max-w-48"
        options={PRODUCT_FILTER_OPTIONS}
        value={productFilter}
        onChange={(value) => onProductFilterChange(value ?? "all")}
      />

      <OptionSelect
        aria-label="Filter status"
        className="w-full max-w-48"
        options={STATUS_FILTER_OPTIONS}
        value={statusFilter}
        onChange={(value) => onStatusFilterChange(value ?? "all")}
      />

      {hasFilters && (
        <Button size="sm" variant="tertiary" onPress={resetFilters}>
          <X />
          Reset Filter
        </Button>
      )}

      <div className="ml-auto">
        <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
      </div>
    </div>
  )
}
