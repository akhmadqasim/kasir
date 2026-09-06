import { useState, useMemo } from "react"
import { SearchField, Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatRupiah, toLocalDateString } from "@/lib/format"
import { useDebounce } from "@/hooks/use-debounce"
import { useProductSales } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Penjualan Produk"
const COLUMN_COUNT = 7
const SEARCH_PLACEHOLDER = "Cari produk..."

export function ProductSalesPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = useProductSales(startDate, endDate)

  // Pencariannya disaring di sini, bukan di backend: laporannya sudah utuh di memori.
  const filtered = useMemo(() => {
    if (!data) return []
    if (!debouncedSearch) return data
    const q = debouncedSearch.toLowerCase()
    return data.filter((r) => r.productName.toLowerCase().includes(q))
  }, [data, debouncedSearch])

  return (
    <ReportPage
      title={TITLE}
      filters={
        <>
          <SearchField
            aria-label={SEARCH_PLACEHOLDER}
            className="w-64"
            value={search}
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={SEARCH_PLACEHOLDER} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
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
        columns={
          <>
            <Table.Column isRowHeader>Produk</Table.Column>
            <Table.Column>Barcode</Table.Column>
            <Table.Column>Kategori</Table.Column>
            <Table.Column className="text-right">Qty Terjual</Table.Column>
            <Table.Column className="text-right">Pendapatan</Table.Column>
            <Table.Column className="text-right">Modal</Table.Column>
            <Table.Column className="text-right">Laba</Table.Column>
          </>
        }
      >
        {filtered.map((row) => (
          <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
            <Table.Cell className="font-medium">{row.productName}</Table.Cell>
            <Table.Cell className="font-mono text-sm text-muted">{row.barcode ?? "-"}</Table.Cell>
            <Table.Cell className="text-muted">{row.categoryName ?? "-"}</Table.Cell>
            <Table.Cell className="text-right">{row.qtySold}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalCost)}</Table.Cell>
            {/* Angka laporan sudah bersih dari retur, jadi produk yang periode itu
                hanya diretur muncul dengan qty dan laba negatif. Laba negatif
                dicetak hijau adalah kebohongan yang mudah dipercaya. */}
            <Table.Cell
              className={`text-right font-medium ${row.profit < 0 ? "text-danger" : "text-success"}`}
            >
              {formatRupiah(row.profit)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
