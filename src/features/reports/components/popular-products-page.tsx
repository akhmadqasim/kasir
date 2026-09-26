import { useState } from "react"
import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { OptionSelect } from "@/components/option-select"
import { RankBadge } from "@/components/rank-badge"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { usePopularProducts } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = id.reports.title.popularProducts
const COLUMN_COUNT = 5

const LIMIT_OPTIONS = [10, 20, 50].map((count) => ({
  key: String(count),
  label: id.reports.topLimit(count),
}))

export function PopularProductsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const [limit, setLimit] = useState(20)

  const { data, isLoading, isFetching, error, refetch } = usePopularProducts(
    startDate,
    endDate,
    limit,
  )

  return (
    <ReportPage
      filters={
        <>
          <OptionSelect
            aria-label={id.reports.topLimitLabel}
            className="w-32"
            options={LIMIT_OPTIONS}
            value={String(limit)}
            onChange={(key) => setLimit(Number(key ?? 20))}
          />
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </>
      }
    >
      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={id.reports.empty.productsSold}
        columns={
          <>
            <Table.Column className="w-16">{id.reports.column.rank}</Table.Column>
            <Table.Column isRowHeader>{id.reports.column.product}</Table.Column>
            <Table.Column>{id.reports.column.category}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.qtySold}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.totalRevenue}</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => (
          <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
            <Table.Cell>
              <RankBadge rank={row.rank} />
            </Table.Cell>
            <Table.Cell className="font-medium">{row.productName}</Table.Cell>
            <Table.Cell className="text-muted">{row.categoryName ?? "-"}</Table.Cell>
            <Table.Cell className="text-right font-medium">{formatNumber(row.qtySold)}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
