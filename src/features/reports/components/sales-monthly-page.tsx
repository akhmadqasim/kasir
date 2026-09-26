import { useState } from "react"

import { id } from "@/i18n/id"
import { OptionSelect } from "@/components/option-select"
import { formatCalendarMonth } from "../calendar-day"
import { useSalesMonthly } from "../hooks/use-reports"
import { sumSalesRows } from "../sales-totals"
import { ReportPage } from "./report-shell"
import { SalesSummaryCards } from "./sales-summary-cards"
import { SalesTable } from "./sales-table"

/** Tahun yang bisa dipilih, dihitung mundur dari tahun berjalan. */
const YEAR_CHOICES = 5

export function SalesMonthlyPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { data, isLoading, isFetching, error, refetch } = useSalesMonthly(year)

  const years = Array.from({ length: YEAR_CHOICES }, (_, i) => currentYear - i)
  const yearOptions = years.map((option) => ({ key: String(option), label: String(option) }))

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <OptionSelect
            aria-label={id.reports.yearLabel}
            className="w-32"
            options={yearOptions}
            value={String(year)}
            onChange={(key) => setYear(Number(key ?? currentYear))}
          />
        </div>
      }
    >
      <SalesSummaryCards isLoading={isLoading} totals={data && sumSalesRows(data)} />

      <SalesTable
        title={id.reports.title.salesMonthly}
        periodHeader={id.reports.column.month}
        periodClassName="capitalize"
        rows={(data ?? []).map((row) => ({
          ...row,
          id: row.month,
          label: formatCalendarMonth(row.month),
        }))}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={id.reports.empty.salesInYear(year)}
      />
    </ReportPage>
  )
}
