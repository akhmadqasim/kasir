import { Button, Label, ListBox, Select } from "@heroui/react"
import { X } from "lucide-react"

import { DateRangePicker } from "@/components/date-range-picker"
import { selectedText } from "@/components/selected-text"
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
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label="Filter produk"
        className="w-full max-w-48"
        placeholder="Semua Produk"
        value={productFilter}
        onChange={(value) => onProductFilterChange(String(value))}
      >
        <Select.Trigger>
          <Select.Value>{selectedText}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {PRODUCT_FILTER_OPTIONS.map((opt) => (
              <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                <Label>{opt.label}</Label>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Select
        aria-label="Filter status"
        className="w-full max-w-48"
        placeholder="Semua Status"
        value={statusFilter}
        onChange={(value) => onStatusFilterChange(String(value))}
      >
        <Select.Trigger>
          <Select.Value>{selectedText}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                <Label>{opt.label}</Label>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      {hasFilters && (
        <Button size="sm" variant="tertiary" onPress={resetFilters}>
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
