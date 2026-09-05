import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Skeleton } from "@heroui/react"
import { ArrowLeft, Search } from "lucide-react"

import type { DateRange } from "@/lib/date-range"
import { id as i18n } from "@/i18n/id"
import { toLocalDateString } from "@/lib/format"
import { usePpobHistory } from "../../hooks"
import { HistoryFilters } from "./history-filters"
import { HistoryTable } from "./history-table"
import {
  getDefaultDateRange,
  getDefaultDateRangeDates,
  matchesProductFilter,
  normalizeStatus,
} from "./history-utils"

export function PpobHistory() {
  const navigate = useNavigate()
  const defaults = getDefaultDateRange()

  const [productFilter, setProductFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    getDefaultDateRangeDates
  )

  // The picker holds local dates; `toISOString()` here would send yesterday.
  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : defaults.start
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : defaults.end

  const { data: items, isLoading, error } = usePpobHistory(startDate, endDate)

  const filteredItems = useMemo(() => {
    if (!items) return []
    return items.filter((item) => {
      if (!matchesProductFilter(item, productFilter)) return false
      if (statusFilter !== "all" && normalizeStatus(item.status) !== statusFilter) return false
      return true
    })
  }, [items, productFilter, statusFilter])

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Button
          aria-label={i18n.common.back}
          isIconOnly
          variant="ghost"
          onPress={() => navigate("/ppob")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{i18n.ppob.history}</h1>
      </div>

      <HistoryFilters
        productFilter={productFilter}
        statusFilter={statusFilter}
        dateRange={dateRange}
        onProductFilterChange={setProductFilter}
        onStatusFilterChange={setStatusFilter}
        onDateRangeChange={setDateRange}
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="mb-1 font-medium text-danger">Gagal memuat riwayat</p>
          <p className="text-sm text-muted">
            {error instanceof Error ? error.message : "Terjadi kesalahan"}
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="mb-3 h-10 w-10 text-muted" />
          <p className="mb-1 font-medium">Tidak ada transaksi</p>
          <p className="text-sm text-muted">
            Tidak ditemukan riwayat pada rentang tanggal yang dipilih
          </p>
        </div>
      ) : (
        <HistoryTable items={filteredItems} />
      )}
    </div>
  )
}
