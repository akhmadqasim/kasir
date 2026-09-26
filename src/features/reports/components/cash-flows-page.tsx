import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { formatDayDate, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useCashFlows } from "../hooks/use-reports"
import { profitTone } from "../sales-totals"
import { ReportPage, ReportTable, StatSkeleton } from "./report-shell"

const TITLE = id.reports.title.cashFlows
const COLUMN_COUNT = 5

export function CashFlowsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, isFetching, error, refetch } = useCashFlows(startDate, endDate)

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
            label={id.reports.stat.totalIn}
            tone="success"
            value={data ? formatRupiah(data.totalIn) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.totalOut}
            tone="danger"
            value={data ? formatRupiah(data.totalOut) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.netBalance}
            tone={data ? profitTone(data.netTotal) : "default"}
            value={data ? formatRupiah(data.netTotal) : <StatSkeleton />}
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
        emptyMessage={id.reports.empty.cashFlows}
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.date}</Table.Column>
            <Table.Column>{id.reports.column.cashier}</Table.Column>
            <Table.Column>{id.reports.column.kind}</Table.Column>
            <Table.Column>{id.reports.column.description}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.amount}</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => {
          const isIn = row.flowType === "in"
          return (
            <Table.Row key={row.id} id={row.id} textValue={formatDayDate(row.createdAt)}>
              <Table.Cell className="whitespace-nowrap text-muted">
                {formatDayDate(row.createdAt)}
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap">{row.cashierName}</Table.Cell>
              {/* Teks, bukan lencana: jenis bukan status, dan arahnya sudah dibaca
                  dari tanda serta warna nominal di ujung baris (DESIGN.md §5.4). */}
              <Table.Cell>{isIn ? id.reports.cashIn : id.reports.cashOut}</Table.Cell>
              <Table.Cell className="max-w-[320px] whitespace-normal break-words text-muted">
                {row.description}
              </Table.Cell>
              <Table.Cell
                className={cn(
                  "text-right font-medium whitespace-nowrap",
                  isIn ? "text-success" : "text-danger",
                )}
              >
                {isIn ? "+" : "-"}
                {formatRupiah(row.amount)}
              </Table.Cell>
            </Table.Row>
          )
        })}
      </ReportTable>
    </ReportPage>
  )
}
