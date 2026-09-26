import { id } from "@/i18n/id"

import { DateRangePicker } from "@/components/date-range-picker"
import { formatCalendarDay } from "../calendar-day"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useSalesPeriod } from "../hooks/use-reports"
import { ReportPage } from "./report-shell"
import { SalesSummaryCards } from "./sales-summary-cards"
import { SalesTable } from "./sales-table"

export function SalesPeriodPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, isFetching, error, refetch } = useSalesPeriod(startDate, endDate)

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {/* Totalnya dari server, tidak dijumlahkan dari rincian harian di bawah. */}
      <SalesSummaryCards
        isLoading={isLoading}
        totals={
          data && {
            transactions: data.totalTransactions,
            revenue: data.totalRevenue,
            cost: data.totalCost,
            profit: data.grossProfit,
          }
        }
        withAverage
        averagePerTransaction={data?.avgPerTransaction}
      />

      <SalesTable
        title={id.reports.title.salesPeriod}
        periodHeader={id.reports.column.date}
        periodClassName="whitespace-nowrap"
        rows={(data?.dailyBreakdown ?? []).map((row) => ({
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
