import { useState } from "react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import { useSalesPeriod } from "../hooks/use-reports"
import { ReportPage, ReportStatCard, ReportTable } from "./report-shell"

const TITLE = "Penjualan per Periode"
const COLUMN_COUNT = 5

export function SalesPeriodPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = useSalesPeriod(startDate, endDate)

  return (
    <ReportPage
      title={TITLE}
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {data && (
        <div className="grid grid-cols-5 gap-4">
          <ReportStatCard label="Total Transaksi" value={data.totalTransactions} />
          <ReportStatCard label="Total Pendapatan" value={formatRupiah(data.totalRevenue)} />
          <ReportStatCard label="Total Modal" value={formatRupiah(data.totalCost)} />
          <ReportStatCard
            label="Laba Kotor"
            tone="success"
            value={formatRupiah(data.grossProfit)}
          />
          <ReportStatCard
            label="Rata-rata / Transaksi"
            value={formatRupiah(data.avgPerTransaction)}
          />
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
        {(data?.dailyBreakdown ?? []).map((row) => (
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
