import { useState } from "react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatusBadge, type StatusVariant } from "@/components/status-badge"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import { useReturns } from "../hooks/use-reports"
import { ReportPage, ReportStatCard, ReportTable } from "./report-shell"

const TITLE = "Retur Produk"
const COLUMN_COUNT = 7

const TYPE_LABELS: Record<string, string> = {
  refund: "Refund",
  exchange: "Tukar",
}

/** Refund menguras kas, tukar barang tidak — karena itu hanya refund yang merah. */
const TYPE_VARIANTS: Record<string, StatusVariant> = {
  refund: "error",
  exchange: "neutral",
}

export function ReturnsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = useReturns(startDate, endDate)

  const totals = data?.reduce(
    (acc, r) => ({ count: acc.count + 1, amount: acc.amount + r.totalRefundAmount }),
    { count: 0, amount: 0 },
  )

  return (
    <ReportPage
      title={TITLE}
      filters={
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      }
    >
      {totals && (
        <div className="grid grid-cols-2 gap-4">
          <ReportStatCard label="Total Retur" value={totals.count} />
          <ReportStatCard
            label="Total Nilai Retur"
            tone="danger"
            value={formatRupiah(totals.amount)}
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
            <Table.Column isRowHeader>No. Refund</Table.Column>
            <Table.Column>No. Struk Asli</Table.Column>
            <Table.Column>Kasir</Table.Column>
            <Table.Column>Tipe</Table.Column>
            <Table.Column className="text-right">Jumlah</Table.Column>
            <Table.Column>Alasan</Table.Column>
            <Table.Column>Tanggal</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.refundNumber}>
            <Table.Cell className="font-mono text-sm">{row.refundNumber}</Table.Cell>
            <Table.Cell className="font-mono text-sm">{row.transactionReceipt}</Table.Cell>
            <Table.Cell>{row.cashierName}</Table.Cell>
            <Table.Cell>
              <StatusBadge status={TYPE_VARIANTS[row.type] ?? "neutral"}>
                {TYPE_LABELS[row.type] ?? row.type}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-right font-medium text-danger">
              {formatRupiah(row.totalRefundAmount)}
            </Table.Cell>
            <Table.Cell className="max-w-[200px] truncate text-sm text-muted">
              {row.reason ?? "-"}
            </Table.Cell>
            <Table.Cell className="text-sm text-muted">{formatDayDate(row.createdAt)}</Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
