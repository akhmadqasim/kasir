import { X, CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              data-empty={!dateRange?.from}
              className="justify-start px-2.5 font-normal data-[empty=true]:text-muted-foreground"
            >
              <CalendarIcon />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "dd MMM yyyy", { locale: idLocale })}
                    {" - "}
                    {format(dateRange.to, "dd MMM yyyy", { locale: idLocale })}
                  </>
                ) : (
                  format(dateRange.from, "dd MMM yyyy", { locale: idLocale })
                )
              ) : (
                <span>Pilih tanggal</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={onDateRangeChange}
              numberOfMonths={2}
              locale={idLocale}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
