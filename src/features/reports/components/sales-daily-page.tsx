import { id } from "@/i18n/id"

import { DateRangePicker } from "@/components/date-range-picker"
import { formatCalendarDay } from "../calendar-day"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useSalesDaily } from "../hooks/use-reports"
import { sumSalesRows } from "../sales-totals"
import { ReportPage } from "./report-shell"
import { SalesSummaryCards } from "./sales-summary-cards"
import { SalesTable } from "./sales-table"

export function SalesDailyPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, isFetching, error, refetch } = useSalesDaily(startDate, endDate)

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      <SalesSummaryCards isLoading={isLoading} totals={data && sumSalesRows(data)} />

      <SalesTable
        title={id.reports.title.salesDaily}
        periodHeader={id.reports.column.date}
        periodClassName="whitespace-nowrap"
        rows={(data ?? []).map((row) => ({
          ...row,
          id: row.date,
          label: formatCalendarDay(row.date),
        }))}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={id.reports.empty.sales}
      />
    </ReportPage>
  )
}
