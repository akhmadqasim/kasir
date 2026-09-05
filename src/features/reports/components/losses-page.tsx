import { useState } from "react"
import { Card, Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatusBadge, type StatusVariant } from "@/components/status-badge"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import { useLosses } from "../hooks/use-reports"
import { ReportPage, ReportStatCard, ReportTable } from "./report-shell"

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
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = useLosses(startDate, endDate)

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
        <>
          <div className="grid grid-cols-3 gap-4">
            <ReportStatCard label="Total Write-off" value={data.totalWriteoffs} />
            <ReportStatCard label="Total Qty" value={data.totalQuantity} />
            <ReportStatCard
              label="Total Kerugian"
              tone="danger"
              value={formatRupiah(data.totalLossValue)}
            />
          </div>

          {data.byReason.length > 0 && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {data.byReason.map((r) => (
                /* Bukan `ReportStatCard`: labelnya sebuah badge beralasan dan angkanya
                   berdampingan dengan jumlah kejadian, bukan label teks polos. */
                <Card key={r.reason}>
                  <Card.Content className="pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <StatusBadge status={REASON_VARIANTS[r.reason] ?? "neutral"}>
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </StatusBadge>
                      <span className="text-sm text-muted">{r.count}x</span>
                    </div>
                    <p className="text-lg font-bold text-danger">
                      {formatRupiah(r.totalValue)}
                    </p>
                  </Card.Content>
                </Card>
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
            <Table.Cell className="font-mono text-sm">{row.writeoffNumber}</Table.Cell>
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
            <Table.Cell className="max-w-[150px] truncate text-sm text-muted">
              {row.notes ?? "-"}
            </Table.Cell>
            <Table.Cell>
              <StatusBadge status={STATUS_VARIANTS[row.status] ?? "neutral"}>
                {STATUS_LABELS[row.status] ?? row.status}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-sm text-muted">
              {formatDayDate(row.createdAt)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
