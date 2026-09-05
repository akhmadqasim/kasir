import { useState } from "react"
import { Card, Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatRupiah, toLocalDateString } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { usePaymentMethods } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Jenis Pembayaran"
const COLUMN_COUNT = 4

const paymentColors: Record<string, string> = {
  cash: "bg-[var(--chart-1)]",
  qris: "bg-[var(--chart-2)]",
  debit: "bg-[var(--chart-4)]",
  ewallet: "bg-[var(--chart-3)]",
  transfer: "bg-[var(--chart-5)]",
}

export function PaymentMethodsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = usePaymentMethods(startDate, endDate)

  const rows = data ?? []
  const total = rows.reduce((sum, r) => sum + r.totalAmount, 0)
  const totalTransactions = rows.reduce((sum, r) => sum + r.transactionCount, 0)

  return (
    <ReportPage
      title={TITLE}
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {rows.map((row) => (
            /* Bukan `ReportStatCard`: kartu ini membawa jumlah transaksi dan bilah
               persentase di bawah angkanya. Bilahnya murni hiasan — persentasenya
               sudah tertulis sebagai teks tepat di atasnya. */
            <Card key={row.paymentMethod}>
              <Card.Header className="pb-2">
                <Card.Description className="text-sm font-medium text-muted">
                  {paymentMethodLabel(row.paymentMethod)}
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <p className="text-2xl font-bold">{formatRupiah(row.totalAmount)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-muted">
                    {row.transactionCount} transaksi
                  </span>
                  <span className="text-sm font-medium">
                    ({row.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-default">
                  <div
                    className={`h-2 rounded-full ${paymentColors[row.paymentMethod] ?? "bg-[var(--muted-foreground)]"}`}
                    style={{ width: `${row.percentage}%` }}
                  />
                </div>
              </Card.Content>
            </Card>
          ))}
        </div>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        columns={
          <>
            <Table.Column isRowHeader>Metode Pembayaran</Table.Column>
            <Table.Column className="text-right">Jumlah Transaksi</Table.Column>
            <Table.Column className="text-right">Total</Table.Column>
            <Table.Column className="text-right">Persentase</Table.Column>
          </>
        }
      >
        {rows.map((row) => (
          <Table.Row
            key={row.paymentMethod}
            id={row.paymentMethod}
            textValue={paymentMethodLabel(row.paymentMethod)}
          >
            <Table.Cell className="font-medium">
              {paymentMethodLabel(row.paymentMethod)}
            </Table.Cell>
            <Table.Cell className="text-right">{row.transactionCount}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalAmount)}</Table.Cell>
            <Table.Cell className="text-right">{row.percentage.toFixed(1)}%</Table.Cell>
          </Table.Row>
        ))}
        {/* Baris total ikut di dalam `Table.Body`, bukan `Table.Footer`: kaki HeroUI
            duduk di luar `<table>` dan tidak punya kolom untuk disejajarkan. Baris ini
            hanya muncul kalau ada datanya, supaya tabel kosong tetap jatuh ke
            `renderEmptyState`. */}
        {rows.length > 0 && (
          <Table.Row id="total" className="font-bold" textValue="Total">
            <Table.Cell>Total</Table.Cell>
            <Table.Cell className="text-right">{totalTransactions}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(total)}</Table.Cell>
            <Table.Cell className="text-right">100%</Table.Cell>
          </Table.Row>
        )}
      </ReportTable>
    </ReportPage>
  )
}
