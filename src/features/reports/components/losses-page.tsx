import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { formatDayDate, formatNumber, formatRupiah } from "@/lib/format"
import {
  writeoffReasonLabel,
  writeoffStatusLabel,
  writeoffStatusVariant,
} from "@/features/stock/labels"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useLosses } from "../hooks/use-reports"
import { ReportPage, ReportTable, StatSkeleton } from "./report-shell"

const TITLE = id.reports.title.losses
const COLUMN_COUNT = 7

export function LossesPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, isFetching, error, refetch } = useLosses(startDate, endDate)

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {(isLoading || data) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label={id.reports.stat.totalWriteoffs}
            value={data ? formatNumber(data.totalWriteoffs) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.totalQuantity}
            value={data ? formatNumber(data.totalQuantity) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.totalLoss}
            tone="danger"
            value={data ? formatRupiah(data.totalLossValue) : <StatSkeleton />}
          />
        </div>
      )}

      {/* Kolomnya sama dengan baris total di atas, supaya tepi kartu alasan
          sejajar dengannya; empat kolom di sini membuat kartunya menyempit dan
          tepinya jatuh di tengah kartu di atasnya. */}
      {data && data.byReason.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {data.byReason.map((r) => (
            /* Alasan jadi label kartu, jumlah kejadian jadi lencana netral (`note`). */
            <StatCard
              key={r.reason}
              label={writeoffReasonLabel(r.reason)}
              note={`${formatNumber(r.count)}x`}
              tone="danger"
              value={formatRupiah(r.totalValue)}
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
        emptyMessage={id.reports.empty.writeoffs}
        // Catatan di bawah nama produk dan kasir di bawah tanggal, seperti layar
        // Stok Write-off dan Riwayat: sebagai kolom sendiri, sembilan kolom tidak
        // muat di area isi layar 1024px dan kolom Tanggal tergulir keluar.
        contentClassName="min-w-[820px]"
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.writeoffNumber}</Table.Column>
            <Table.Column>{id.reports.column.product}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.qty}</Table.Column>
            <Table.Column>{id.reports.column.reason}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.lossValue}</Table.Column>
            <Table.Column>{id.reports.column.status}</Table.Column>
            <Table.Column>
              {id.reports.column.date} / {id.reports.column.cashier}
            </Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.writeoffNumber}>
            <Table.Cell className="font-mono whitespace-nowrap">{row.writeoffNumber}</Table.Cell>
            <Table.Cell>
              {/* `title`: catatan yang terpotong tetap bisa dibaca utuh saat disorot. */}
              <div className="flex max-w-xs flex-col">
                <span className="font-medium text-pretty">{row.productName}</span>
                {row.notes ? (
                  <span className="truncate text-xs text-muted" title={row.notes}>
                    {row.notes}
                  </span>
                ) : null}
              </div>
            </Table.Cell>
            <Table.Cell className="text-right">{formatNumber(row.quantity)}</Table.Cell>
            {/* Teks, bukan lencana: alasan adalah kategori yang ada di setiap baris,
                bukan status (DESIGN.md §5.4) — sama dengan layar write-off stok. */}
            <Table.Cell>{writeoffReasonLabel(row.reason)}</Table.Cell>
            <Table.Cell className="text-right font-medium text-danger">
              {formatRupiah(row.lossValue)}
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap">
              <StatusBadge size="sm" status={writeoffStatusVariant(row.status)}>
                {writeoffStatusLabel(row.status)}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap">
              <div className="flex flex-col">
                <span>{formatDayDate(row.createdAt)}</span>
                <span className="max-w-40 truncate text-xs text-muted">{row.cashierName}</span>
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
