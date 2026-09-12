import { Meter, Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { usePaymentMethods } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Jenis Pembayaran"
const COLUMN_COUNT = 4

export function PaymentMethodsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
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
            /* Porsinya jadi lencana netral (`note`), bilahnya `Meter` HeroUI di
               kaki kartu. Jumlah transaksi tidak diulang di sini — ada di tabel. */
            <StatCard
              key={row.paymentMethod}
              label={paymentMethodLabel(row.paymentMethod)}
              note={`${row.percentage.toFixed(1)}%`}
              value={formatRupiah(row.totalAmount)}
              footer={
                /* Angka laporan bersih dari retur, jadi sebuah metode yang periode
                   itu hanya kena retur muncul dengan porsi negatif. React Aria
                   menjepit `value` ke 0–100, sehingga bilahnya tidak pernah
                   mendapat lebar negatif. */
                <Meter
                  aria-label={`Porsi ${paymentMethodLabel(row.paymentMethod)}`}
                  size="sm"
                  value={row.percentage}
                >
                  <Meter.Track>
                    <Meter.Fill />
                  </Meter.Track>
                </Meter>
              }
            />
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
