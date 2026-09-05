import { useState } from "react"
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatusBadge } from "@/components/status-badge"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import { useCashFlows } from "../hooks/use-reports"
import { ReportPage, ReportStatCard, ReportTable } from "./report-shell"

const TITLE = "Uang Masuk / Keluar"
const COLUMN_COUNT = 5

export function CashFlowsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate
  const { data, isLoading, error } = useCashFlows(startDate, endDate)

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ReportStatCard
            label="Total Uang Masuk"
            tone="success"
            value={formatRupiah(data.totalIn)}
          />
          <ReportStatCard
            label="Total Uang Keluar"
            tone="danger"
            value={formatRupiah(data.totalOut)}
          />
          <ReportStatCard
            label="Saldo Bersih"
            tone={data.netTotal >= 0 ? "success" : "danger"}
            value={formatRupiah(data.netTotal)}
          />
        </div>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        columns={
          <>
            <Table.Column isRowHeader>Tanggal</Table.Column>
            <Table.Column>Kasir</Table.Column>
            <Table.Column>Jenis</Table.Column>
            <Table.Column>Keterangan</Table.Column>
            <Table.Column className="text-right">Nominal</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => {
          const isIn = row.flowType === "in"
          const Icon = isIn ? ArrowDownCircle : ArrowUpCircle
          return (
            <Table.Row key={row.id} id={row.id} textValue={formatDayDate(row.createdAt)}>
              <Table.Cell className="text-sm text-muted">
                {formatDayDate(row.createdAt)}
              </Table.Cell>
              <Table.Cell>{row.cashierName}</Table.Cell>
              <Table.Cell>
                <StatusBadge status={isIn ? "neutral" : "error"}>
                  <span className="flex items-center gap-1.5">
                    <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                    {isIn ? "Uang Masuk" : "Uang Keluar"}
                  </span>
                </StatusBadge>
              </Table.Cell>
              <Table.Cell className="max-w-[320px] whitespace-normal break-words text-sm text-muted">
                {row.description}
              </Table.Cell>
              <Table.Cell
                className={`text-right font-medium tabular-nums ${isIn ? "text-success" : "text-danger"}`}
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
