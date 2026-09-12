import { useState } from "react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatNumber, formatRupiah, toLocalDateString } from "@/lib/format"
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

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
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
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((row) => (
            /* Bilah persentase murni hiasan — persentasenya sudah tertulis
               sebagai teks tepat di atasnya — jadi ia duduk di `footer`. */
            <StatCard
              key={row.paymentMethod}
              label={paymentMethodLabel(row.paymentMethod)}
              value={formatRupiah(row.totalAmount)}
              footer={
                <div aria-hidden="true" className="h-2 w-full rounded-full bg-default">
                  {/* Angka laporan bersih dari retur, jadi sebuah metode yang
                      periode itu hanya kena retur muncul dengan nominal negatif —
                      dan `width: -12%` adalah deklarasi CSS tidak sah yang
                      diam-diam dibuang browser. Dijepit supaya bilahnya selalu
                      punya lebar yang masuk akal. */}
                  <div
                    className={`h-2 rounded-full ${paymentColors[row.paymentMethod] ?? "bg-muted"}`}
                    style={{ width: `${clampPercentage(row.percentage)}%` }}
                  />
                </div>
              }
            >
              <p className="text-sm text-muted tabular-nums">
                {formatNumber(row.transactionCount)} transaksi <span aria-hidden="true">·</span>{" "}
                {row.percentage.toFixed(1)}%
              </p>
            </StatCard>
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
            <Table.Cell className="font-medium">{paymentMethodLabel(row.paymentMethod)}</Table.Cell>
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
          <Table.Row id="total" className="font-semibold" textValue="Total">
            <Table.Cell>Total</Table.Cell>
            <Table.Cell className="text-right">{totalTransactions}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(total)}</Table.Cell>
            {/* Dijumlahkan, bukan ditulis "100%": sebuah metode bisa muncul dengan
                nominal negatif sekarang, dan persentasenya tidak selalu genap. */}
            <Table.Cell className="text-right">
              {rows.reduce((sum, r) => sum + r.percentage, 0).toFixed(1)}%
            </Table.Cell>
          </Table.Row>
        )}
      </ReportTable>
    </ReportPage>
  )
}
