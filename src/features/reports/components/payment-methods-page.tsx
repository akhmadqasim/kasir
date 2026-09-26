import { Meter, Skeleton, Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { formatNumber, formatPercent, formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { usePaymentMethods } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = id.reports.title.paymentMethods
const COLUMN_COUNT = 4
/** Kartu bayangan selagi memuat: satu baris penuh di layar lebar. */
const SKELETON_CARDS = 4

export function PaymentMethodsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, isFetching, error, refetch } = usePaymentMethods(startDate, endDate)

  const rows = data?.rows ?? []
  const total = rows.reduce((sum, r) => sum + r.totalAmount, 0)
  // Dari server, bukan dijumlahkan: penjualan split terhitung di tiap metodenya.
  const totalTransactions = data?.totalTransactions ?? 0

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            // Labelnya nama metode, yang baru diketahui setelah data datang — jadi
            // yang dibayangkan seluruh kartunya, setinggi kartu berbilah di bawah.
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((row) => (
            /* Porsinya jadi lencana netral (`note`), bilahnya `Meter` HeroUI di
               kaki kartu. Jumlah transaksi tidak diulang di sini — ada di tabel. */
            <StatCard
              key={row.paymentMethod}
              label={paymentMethodLabel(row.paymentMethod)}
              note={`${formatPercent(row.percentage)}%`}
              value={formatRupiah(row.totalAmount)}
              footer={
                /* Angka laporan bersih dari retur, jadi sebuah metode yang periode
                   itu hanya kena retur muncul dengan porsi negatif. React Aria
                   menjepit `value` ke 0–100, sehingga bilahnya tidak pernah
                   mendapat lebar negatif.
                   `aria-hidden`: bilah ini hanya gambaran dari persentase yang sudah
                   tertulis di lencana kartu dan di tabel, jadi pembaca layar tidak
                   perlu mendengarnya dua kali. React Aria juga menulis
                   `role="meter progressbar"`, yang oleh axe dibaca sebagai elemen
                   tanpa peran dengan atribut `aria-value*` terlarang (critical). */
                <div aria-hidden="true" className="w-full">
                  <Meter
                    aria-label={id.reports.paymentShare(paymentMethodLabel(row.paymentMethod))}
                    className="w-full"
                    size="sm"
                    value={row.percentage}
                  >
                    <Meter.Track>
                      <Meter.Fill />
                    </Meter.Track>
                  </Meter>
                </div>
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
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={id.reports.empty.payments}
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.paymentMethod}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.transactionCount}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.total}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.share}</Table.Column>
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
            <Table.Cell className="text-right">{formatNumber(row.transactionCount)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalAmount)}</Table.Cell>
            <Table.Cell className="text-right">{formatPercent(row.percentage)}%</Table.Cell>
          </Table.Row>
        ))}
        {/* Baris total ikut di dalam `Table.Body`, bukan `Table.Footer`: kaki HeroUI
            duduk di luar `<table>` dan tidak punya kolom untuk disejajarkan. Baris ini
            hanya muncul kalau ada datanya, supaya tabel kosong tetap jatuh ke
            `renderEmptyState`. */}
        {rows.length > 0 && (
          <Table.Row id="total" className="font-semibold" textValue={id.reports.column.total}>
            <Table.Cell>{id.reports.column.total}</Table.Cell>
            <Table.Cell className="text-right">{formatNumber(totalTransactions)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(total)}</Table.Cell>
            {/* Dijumlahkan, bukan ditulis "100%": sebuah metode bisa muncul dengan
                nominal negatif sekarang, dan persentasenya tidak selalu genap. */}
            <Table.Cell className="text-right">
              {formatPercent(rows.reduce((sum, r) => sum + r.percentage, 0))}%
            </Table.Cell>
          </Table.Row>
        )}
      </ReportTable>
    </ReportPage>
  )
}
