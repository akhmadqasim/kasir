import { useState } from "react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { Label, ListBox, Select, Table } from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { StatCard } from "@/components/stat-card"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useSalesMonthly } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Penjualan per Bulan"
const COLUMN_COUNT = 5
/** Tahun yang bisa dipilih, dihitung mundur dari tahun berjalan. */
const YEAR_CHOICES = 5

export function SalesMonthlyPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { data, isLoading, error } = useSalesMonthly(year)

  const years = Array.from({ length: YEAR_CHOICES }, (_, i) => currentYear - i)

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
          <Select
            aria-label="Tahun laporan"
            className="w-32"
            value={String(year)}
            onChange={(value) => setYear(Number(value))}
          >
            <Select.Trigger>
              <Select.Value>{selectedText}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {years.map((option) => (
                  <ListBox.Item key={option} id={String(option)} textValue={String(option)}>
                    <Label>{option}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
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
            <Table.Column isRowHeader>Bulan</Table.Column>
            <Table.Column className="text-right">Transaksi</Table.Column>
            <Table.Column className="text-right">Pendapatan</Table.Column>
            <Table.Column className="text-right">Modal</Table.Column>
            <Table.Column className="text-right">Laba Kotor</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => {
          const monthLabel = format(new Date(`${row.month}-01`), "MMMM yyyy", {
            locale: idLocale,
          })
          return (
            <Table.Row key={row.month} id={row.month} textValue={monthLabel}>
              <Table.Cell className="font-medium">{monthLabel}</Table.Cell>
              <Table.Cell className="text-right">{row.transactionCount}</Table.Cell>
              <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
              <Table.Cell className="text-right">{formatRupiah(row.totalCost)}</Table.Cell>
              <Table.Cell className="text-right font-medium text-success">
                {formatRupiah(row.grossProfit)}
              </Table.Cell>
            </Table.Row>
          )
        })}
      </ReportTable>
    </ReportPage>
  )
}
