import { useState, useMemo } from "react"
import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { SearchInput } from "@/components/search-input"
import { formatNumber, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useProductSales } from "../hooks/use-reports"
import { profitToneClass } from "../sales-totals"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = id.reports.title.productSales
const COLUMN_COUNT = 7
const SEARCH_PLACEHOLDER = id.reports.searchProduct

export function ProductSalesPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, isFetching, error, refetch } = useProductSales(startDate, endDate)

  // Pencariannya disaring di sini, bukan di backend: laporannya sudah utuh di memori.
  const query = debouncedSearch.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!data) return []
    if (!query) return data
    return data.filter((r) => r.productName.toLowerCase().includes(query))
  }, [data, query])

  return (
    <ReportPage
      filters={
        <>
          <SearchInput
            aria-label={SEARCH_PLACEHOLDER}
            placeholder={SEARCH_PLACEHOLDER}
            className="w-full sm:w-64"
            value={search}
            onChange={setSearch}
          />
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </>
      }
    >
      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={
          query && data?.length
            ? id.noMatch.query("produk", debouncedSearch.trim())
            : id.reports.empty.productsSold
        }
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.product}</Table.Column>
            <Table.Column>{id.reports.column.barcode}</Table.Column>
            <Table.Column>{id.reports.column.category}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.qtySold}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.revenue}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.cost}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.profit}</Table.Column>
          </>
        }
      >
        {filtered.map((row) => (
          <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
            {/* `text-pretty`: nama yang terlipat tidak menyisakan satuannya ("g", "kg")
                sendirian di baris kedua. */}
            <Table.Cell className="font-medium text-pretty">{row.productName}</Table.Cell>
            <Table.Cell className="font-mono text-muted">{row.barcode ?? "-"}</Table.Cell>
            <Table.Cell className="text-muted">{row.categoryName ?? "-"}</Table.Cell>
            <Table.Cell className="text-right">{formatNumber(row.qtySold)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalCost)}</Table.Cell>
            {/* Angka laporan sudah bersih dari retur, jadi produk yang periode itu
                hanya diretur muncul dengan qty dan laba negatif. Laba negatif
                dicetak hijau adalah kebohongan yang mudah dipercaya. */}
            <Table.Cell className={cn("text-right font-medium", profitToneClass(row.profit))}>
              {formatRupiah(row.profit)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
