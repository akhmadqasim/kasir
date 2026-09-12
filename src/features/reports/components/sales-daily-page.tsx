import { useState } from "react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatDayDate, formatNumber, formatRupiah, toLocalDateString } from "@/lib/format"
import { useSalesDaily } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Penjualan per Hari"
const COLUMN_COUNT = 5

export function SalesDailyPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = useSalesDaily(startDate, endDate)

  const totals = data?.reduce(
    (acc, row) => ({
      transactions: acc.transactions + row.transactionCount,
      revenue: acc.revenue + row.totalRevenue,
      cost: acc.cost + row.totalCost,
      profit: acc.profit + row.grossProfit,
    }),
    { transactions: 0, revenue: 0, cost: 0, profit: 0 },
  )

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {totals && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Transaksi" value={formatNumber(totals.transactions)} />
          <StatCard label="Total Pendapatan" value={formatRupiah(totals.revenue)} />
          <StatCard label="Total Modal" value={formatRupiah(totals.cost)} />
          <StatCard label="Laba Kotor" tone="success" value={formatRupiah(totals.profit)} />
        </div>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        columns={
          <>
            <Table.Column isRowHeader>Tanggal</Table.Column>
            <Table.Column className="text-right">Transaksi</Table.Column>
            <Table.Column className="text-right">Pendapatan</Table.Column>
            <Table.Column className="text-right">Modal</Table.Column>
            <Table.Column className="text-right">Laba Kotor</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => (
          <Table.Row key={row.date} id={row.date} textValue={formatDayDate(row.date)}>
            <Table.Cell className="font-medium">{formatDayDate(row.date)}</Table.Cell>
            <Table.Cell className="text-right">{row.transactionCount}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalCost)}</Table.Cell>
            <Table.Cell className="text-right font-medium text-success">
              {formatRupiah(row.grossProfit)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
