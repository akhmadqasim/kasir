import { useState } from "react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { OptionSelect } from "@/components/option-select"
import { formatRupiah } from "@/lib/format"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { usePopularProducts } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Produk Populer"
const COLUMN_COUNT = 5

const LIMIT_OPTIONS = [
  { key: "10", label: "Top 10" },
  { key: "20", label: "Top 20" },
  { key: "50", label: "Top 50" },
] as const

export function PopularProductsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const [limit, setLimit] = useState(20)

  const { data, isLoading, error } = usePopularProducts(startDate, endDate, limit)

  return (
    <ReportPage
      filters={
        <>
          <OptionSelect
            aria-label="Jumlah produk teratas"
            className="w-32"
            options={LIMIT_OPTIONS}
            value={String(limit)}
            onChange={(key) => setLimit(Number(key ?? 20))}
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
        columns={
          <>
            <Table.Column className="w-16">Rank</Table.Column>
            <Table.Column isRowHeader>Produk</Table.Column>
            <Table.Column>Kategori</Table.Column>
            <Table.Column className="text-right">Qty Terjual</Table.Column>
            <Table.Column className="text-right">Total Pendapatan</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => (
          <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
            <Table.Cell className="text-muted">{row.rank}</Table.Cell>
            <Table.Cell className="font-medium">{row.productName}</Table.Cell>
            <Table.Cell className="text-muted">{row.categoryName ?? "-"}</Table.Cell>
            <Table.Cell className="text-right font-medium">{row.qtySold}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
