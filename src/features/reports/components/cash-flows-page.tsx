import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatCard } from "@/components/stat-card"
import { formatDayDate, formatRupiah } from "@/lib/format"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useCashFlows } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Uang Masuk / Keluar"
const COLUMN_COUNT = 5

export function CashFlowsPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const { data, isLoading, error } = useCashFlows(startDate, endDate)

  return (
    <ReportPage
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total Uang Masuk" tone="success" value={formatRupiah(data.totalIn)} />
          <StatCard label="Total Uang Keluar" tone="danger" value={formatRupiah(data.totalOut)} />
          <StatCard
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
          return (
            <Table.Row key={row.id} id={row.id} textValue={formatDayDate(row.createdAt)}>
              <Table.Cell className="text-muted">{formatDayDate(row.createdAt)}</Table.Cell>
              <Table.Cell>{row.cashierName}</Table.Cell>
              {/* Teks, bukan lencana: jenis bukan status, dan arahnya sudah dibaca
                  dari tanda serta warna nominal di ujung baris (DESIGN.md §5.4). */}
              <Table.Cell>{isIn ? "Uang Masuk" : "Uang Keluar"}</Table.Cell>
              <Table.Cell className="max-w-[320px] whitespace-normal break-words text-muted">
                {row.description}
              </Table.Cell>
              <Table.Cell
                className={`text-right font-medium ${isIn ? "text-success" : "text-danger"}`}
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
