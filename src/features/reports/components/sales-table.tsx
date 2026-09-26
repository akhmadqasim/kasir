import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { profitToneClass, type SalesFigures } from "../sales-totals"
import { ReportTable } from "./report-shell"

/** Satu baris tabel penjualan: satu hari atau satu bulan, sudah berlabel. */
interface SalesTableRow extends SalesFigures {
  /** Kunci baris — tanggal atau bulan mentah dari backend. */
  id: string
  /** Label kolom pertama, sudah diformat. */
  label: string
}

interface SalesTableProps {
  /** `aria-label` tabel — judul laporannya. */
  title: string
  /** Judul kolom pertama: "Tanggal" atau "Bulan". */
  periodHeader: string
  /** Kelas sel kolom pertama, misalnya `capitalize` untuk nama bulan. */
  periodClassName?: string
  rows: readonly SalesTableRow[]
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  isRetrying: boolean
  emptyMessage: string
}

/**
 * Tabel tiga laporan penjualan: periode, transaksi, pendapatan, modal, laba kotor.
 *
 * Angkanya bersih dari retur, jadi laba sebuah hari atau bulan bisa negatif;
 * hijau hanya untuk yang memang laba (lihat juga Penjualan Produk).
 */
export function SalesTable({
  title,
  periodHeader,
  periodClassName,
  rows,
  isLoading,
  error,
  onRetry,
  isRetrying,
  emptyMessage,
}: SalesTableProps) {
  return (
    <ReportTable
      label={title}
      columnCount={5}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isRetrying={isRetrying}
      emptyMessage={emptyMessage}
      columns={
        <>
          <Table.Column isRowHeader>{periodHeader}</Table.Column>
          <Table.Column className="text-right">{id.reports.column.transactions}</Table.Column>
          <Table.Column className="text-right">{id.reports.column.revenue}</Table.Column>
          <Table.Column className="text-right">{id.reports.column.cost}</Table.Column>
          <Table.Column className="text-right">{id.reports.column.grossProfit}</Table.Column>
        </>
      }
    >
      {rows.map((row) => (
        <Table.Row key={row.id} id={row.id} textValue={row.label}>
          <Table.Cell className={cn("font-medium", periodClassName)}>{row.label}</Table.Cell>
          <Table.Cell className="text-right">{formatNumber(row.transactionCount)}</Table.Cell>
          <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
          <Table.Cell className="text-right">{formatRupiah(row.totalCost)}</Table.Cell>
          <Table.Cell className={cn("text-right font-medium", profitToneClass(row.grossProfit))}>
            {formatRupiah(row.grossProfit)}
          </Table.Cell>
        </Table.Row>
      ))}
    </ReportTable>
  )
}
