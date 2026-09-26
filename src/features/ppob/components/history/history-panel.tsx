import { useState, useMemo } from "react"
import { Button, Card, Skeleton, Spinner } from "@heroui/react"
import { FilterX, ReceiptText, RefreshCw } from "lucide-react"

import { CardHeading } from "@/components/card-heading"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { id as i18n } from "@/i18n/id"
import { usePpobHistory } from "../../hooks"
import { HistoryFilters } from "./history-filters"
import { HistoryTable } from "./history-table"
import { matchesProductFilter, normalizeStatus } from "./history-utils"
import { useLocalDateRange } from "./use-local-date-range"

/**
 * Riwayat transaksi Mitra sebagai kartu di sebelah kanan menu layanan — bukan
 * sub-halaman lagi, supaya kasir melihat menu dan riwayat sekaligus.
 */
export function HistoryPanel() {
  const [productFilter, setProductFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const { dateRange, setDateRange, startDate, endDate } = useLocalDateRange()

  const { data: items, isLoading, isFetching, error, refetch } = usePpobHistory(startDate, endDate)
  const hasFilters = productFilter !== "all" || statusFilter !== "all"

  const resetFilters = () => {
    setProductFilter("all")
    setStatusFilter("all")
  }

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
      {/* "Sudah masuk belum?" adalah pertanyaan yang dibawa kasir ke kartu ini,
          jadi muat-ulangnya ada di kepala kartu, bukan menunggu 30 detik. */}
      <Card.Header className="flex-row items-center justify-between gap-2">
        <CardHeading>{i18n.ppob.history}</CardHeading>
        <Button
          isIconOnly
          aria-label={i18n.reloadLabel.history}
          isPending={isFetching && !isLoading}
          size="sm"
          variant="tertiary"
          onPress={() => refetch()}
        >
          {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />)}
        </Button>
      </Card.Header>
      <Card.Content className="gap-4">
        <HistoryFilters
          productFilter={productFilter}
          statusFilter={statusFilter}
          dateRange={dateRange}
          onProductFilterChange={setProductFilter}
          onStatusFilterChange={setStatusFilter}
          onDateRangeChange={setDateRange}
          onResetFilters={resetFilters}
        />

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : error ? (
          <LoadError
            isRetrying={isFetching}
            title={i18n.loadFailed.ppobHistory}
            onRetry={() => refetch()}
          >
            {error.message}
          </LoadError>
        ) : filteredItems.length === 0 && hasFilters && (items?.length ?? 0) > 0 ? (
          <NoData
            action={
              <Button size="sm" variant="secondary" onPress={resetFilters}>
                {i18n.common.clearFilters}
              </Button>
            }
            icon={<FilterX />}
            title={i18n.noMatch.transactions}
          >
            Ada {items?.length} transaksi pada rentang ini, tapi tidak ada yang cocok dengan filter.
          </NoData>
        ) : filteredItems.length === 0 ? (
          <NoData icon={<ReceiptText />} title={i18n.transactions.noTransactions}>
            {i18n.empty.ppobHistoryHint}
          </NoData>
        ) : (
          <HistoryTable items={filteredItems} />
        )}
      </Card.Content>
    </Card>
  )
}
