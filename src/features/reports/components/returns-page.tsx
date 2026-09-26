import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { formatDayDate, formatNumber, formatRupiah } from "@/lib/format"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useReturns } from "../hooks/use-reports"
import { ReportPage, ReportTable, StatSkeleton } from "./report-shell"

const TITLE = id.reports.title.returns
const COLUMN_COUNT = 7

const TYPE_LABELS: Record<string, string> = {
  refund: id.reports.returnTypeRefund,
  exchange: id.reports.returnTypeExchange,
}

export function ReturnsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, isFetching, error, refetch } = useReturns(startDate, endDate)

  const totals = data?.reduce(
    (acc, r) => ({ count: acc.count + 1, amount: acc.amount + r.totalRefundAmount }),
    { count: 0, amount: 0 },
  )

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {(isLoading || totals) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label={id.reports.stat.totalReturns}
            value={totals ? formatNumber(totals.count) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.totalReturnValue}
            tone="danger"
            value={totals ? formatRupiah(totals.amount) : <StatSkeleton />}
          />
        </div>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={id.reports.empty.returns}
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.refundNumber}</Table.Column>
            <Table.Column>{id.reports.column.originalReceipt}</Table.Column>
            <Table.Column>{id.reports.column.cashier}</Table.Column>
            <Table.Column>{id.reports.column.type}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.returnAmount}</Table.Column>
            <Table.Column>{id.reports.column.reason}</Table.Column>
            <Table.Column>{id.reports.column.date}</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.refundNumber}>
            {/* Nomor dokumen tidak boleh pecah di tanda hubungnya. */}
            <Table.Cell className="font-mono whitespace-nowrap">{row.refundNumber}</Table.Cell>
            <Table.Cell className="font-mono whitespace-nowrap">
              {row.transactionReceipt}
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap">{row.cashierName}</Table.Cell>
            {/* Teks, bukan lencana: tipe adalah kategori yang ada di setiap baris,
                bukan status (DESIGN.md §5.4). */}
            <Table.Cell>{TYPE_LABELS[row.type] ?? row.type}</Table.Cell>
            <Table.Cell className="text-right font-medium text-danger">
              {formatRupiah(row.totalRefundAmount)}
            </Table.Cell>
            {/* `title`: alasan yang terpotong tetap bisa dibaca utuh saat disorot. */}
            <Table.Cell className="max-w-[160px] text-muted">
              <span className="block truncate" title={row.reason ?? undefined}>
                {row.reason ?? "-"}
              </span>
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap text-muted">
              {formatDayDate(row.createdAt)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
