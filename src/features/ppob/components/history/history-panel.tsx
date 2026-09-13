import { useState, useMemo } from "react"
import { Card, Skeleton } from "@heroui/react"
import { Search } from "lucide-react"

import { NoData } from "@/components/no-data"
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

/**
 * Riwayat transaksi Mitra sebagai kartu di sebelah kanan menu layanan — bukan
 * sub-halaman lagi, supaya kasir melihat menu dan riwayat sekaligus.
 */
export function HistoryPanel() {
  const defaults = getDefaultDateRange()

  const [productFilter, setProductFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRangeDates)

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
    <Card>
      <Card.Header>
        <Card.Title>{i18n.ppob.history}</Card.Title>
      </Card.Header>
      <Card.Content className="gap-4">
        <HistoryFilters
          productFilter={productFilter}
          statusFilter={statusFilter}
          dateRange={dateRange}
          onProductFilterChange={setProductFilter}
          onStatusFilterChange={setStatusFilter}
          onDateRangeChange={setDateRange}
        />

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : error ? (
          <NoData title="Gagal memuat riwayat" tone="danger">
            {error.message}
          </NoData>
        ) : filteredItems.length === 0 ? (
          <NoData icon={<Search />} title="Tidak ada transaksi">
            Tidak ditemukan riwayat pada rentang tanggal yang dipilih
          </NoData>
        ) : (
          <HistoryTable items={filteredItems} />
        )}
      </Card.Content>
    </Card>
  )
}
