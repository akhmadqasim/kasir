import { Button } from "@heroui/react"
import { X } from "lucide-react"

import { DateRangePicker } from "@/components/date-range-picker"
import { OptionSelect } from "@/components/option-select"
import type { DateRange } from "@/lib/date-range"
import { id } from "@/i18n/id"
import { PRODUCT_FILTER_OPTIONS, STATUS_FILTER_OPTIONS } from "./history-utils"

interface HistoryFiltersProps {
  productFilter: string
  statusFilter: string
  dateRange: DateRange | undefined
  onProductFilterChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
  onDateRangeChange: (range: DateRange | undefined) => void
  onResetFilters: () => void
}

export function HistoryFilters({
  productFilter,
  statusFilter,
  dateRange,
  onProductFilterChange,
  onStatusFilterChange,
  onDateRangeChange,
  onResetFilters,
}: HistoryFiltersProps) {
  const hasFilters = productFilter !== "all" || statusFilter !== "all"

  // The panel sits in half the screen on a cashier monitor, where the two
  // selects and the date range do not fit on one line. The selects share the
  // first line evenly and the range wraps under them, left-aligned — not one
  // lone field pushed to the right edge of an otherwise empty line.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OptionSelect
        aria-label="Filter produk"
        className="min-w-40 flex-1"
        options={PRODUCT_FILTER_OPTIONS}
        value={productFilter}
        onChange={(value) => onProductFilterChange(value ?? "all")}
      />

      <OptionSelect
        aria-label="Filter status"
        className="min-w-40 flex-1"
        options={STATUS_FILTER_OPTIONS}
        value={statusFilter}
        onChange={(value) => onStatusFilterChange(value ?? "all")}
      />

      {hasFilters && (
        <Button size="sm" variant="tertiary" onPress={onResetFilters}>
          <X />
          {id.common.clearFilters}
        </Button>
      )}

      <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
    </div>
  )
}
