import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { StatusBadge, type StatusVariant } from "@/components/status-badge"
import { formatDayDate, formatNumber, formatRupiah } from "@/lib/format"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useLosses } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Laporan Kerugian"
const COLUMN_COUNT = 9

const REASON_LABELS: Record<string, string> = {
  damaged: "Rusak",
  expired: "Kadaluarsa",
  lost: "Hilang",
  other: "Lainnya",
}

/** Kosakata yang sama dengan layar write-off stok, supaya warnanya tidak berbeda arti. */
const REASON_VARIANTS: Record<string, StatusVariant> = {
  damaged: "error",
  expired: "warning",
  lost: "neutral",
  other: "neutral",
}

const STATUS_LABELS: Record<string, string> = {
  approved: "Disetujui",
  pending: "Menunggu",
  rejected: "Ditolak",
}

const STATUS_VARIANTS: Record<string, StatusVariant> = {
  approved: "success",
  pending: "warning",
  rejected: "error",
}

export function LossesPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, error } = useLosses(startDate, endDate)

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total Write-off" value={formatNumber(data.totalWriteoffs)} />
            <StatCard label="Total Qty" value={formatNumber(data.totalQuantity)} />
            <StatCard
              label="Total Kerugian"
              tone="danger"
              value={formatRupiah(data.totalLossValue)}
            />
          </div>

          {data.byReason.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {data.byReason.map((r) => (
                /* Alasan jadi label kartu, jumlah kejadian jadi lencana netral (`note`).
                   Warna alasan tetap ada di kolom tabel di bawahnya. */
                <StatCard
                  key={r.reason}
                  label={REASON_LABELS[r.reason] ?? r.reason}
                  note={`${formatNumber(r.count)}x`}
                  tone="danger"
                  value={formatRupiah(r.totalValue)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        contentClassName="min-w-[1100px]"
        columns={
          <>
            <Table.Column isRowHeader>No. WO</Table.Column>
            <Table.Column>Produk</Table.Column>
            <Table.Column>Kasir</Table.Column>
            <Table.Column className="text-right">Qty</Table.Column>
            <Table.Column>Alasan</Table.Column>
            <Table.Column className="text-right">Nilai Kerugian</Table.Column>
            <Table.Column>Catatan</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>Tanggal</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.writeoffNumber}>
            <Table.Cell className="font-mono">{row.writeoffNumber}</Table.Cell>
            <Table.Cell className="font-medium">{row.productName}</Table.Cell>
            <Table.Cell>{row.cashierName}</Table.Cell>
            <Table.Cell className="text-right">{row.quantity}</Table.Cell>
            <Table.Cell>
              <StatusBadge status={REASON_VARIANTS[row.reason] ?? "neutral"}>
                {REASON_LABELS[row.reason] ?? row.reason}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-right font-medium text-danger">
              {formatRupiah(row.lossValue)}
            </Table.Cell>
            <Table.Cell className="max-w-[150px] truncate text-muted">
              {row.notes ?? "-"}
            </Table.Cell>
            <Table.Cell>
              <StatusBadge status={STATUS_VARIANTS[row.status] ?? "neutral"}>
                {STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-muted">{formatDayDate(row.createdAt)}</Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
