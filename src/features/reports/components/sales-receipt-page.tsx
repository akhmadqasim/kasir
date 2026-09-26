import { useState } from "react"
import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { DateRangePicker } from "@/components/date-range-picker"
import { SearchInput } from "@/components/search-input"
import { StatusBadge } from "@/components/status-badge"
import { formatDayDate, formatNumber, formatRupiah } from "@/lib/format"
import { paymentMethodLabel, transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useSalesReceipt } from "../hooks/use-reports"
import { ReportPage, ReportTable, TruncationNotice } from "./report-shell"

const TITLE = id.reports.title.salesReceipt
const COLUMN_COUNT = 7
const SEARCH_PLACEHOLDER = id.reports.searchReceipt

export function SalesReceiptPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, isFetching, error, refetch } = useSalesReceipt(
    startDate,
    endDate,
    debouncedSearch,
  )
  const isSearching = debouncedSearch.trim() !== ""

  return (
    <ReportPage
      filters={
        <>
          <SearchInput
            aria-label={SEARCH_PLACEHOLDER}
            placeholder={SEARCH_PLACEHOLDER}
            className="w-full sm:w-64"
            value={search}
            onChange={setSearch}
          />
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </>
      }
    >
      {data && (
        <TruncationNotice shown={data.items.length} total={data.totalCount} noun="struk">
          {id.reports.truncatedReceiptsHint}
        </TruncationNotice>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={
          isSearching
            ? id.noMatch.query("struk", debouncedSearch.trim())
            : id.reports.empty.receipts
        }
        contentClassName="min-w-[860px]"
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.receiptNumber}</Table.Column>
            <Table.Column>
              {id.reports.column.date} / {id.reports.column.cashier}
            </Table.Column>
            <Table.Column>{id.reports.column.paymentMethodShort}</Table.Column>
            <Table.Column>{id.reports.column.status}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.total}</Table.Column>
            {/* Struk berstatus `refunded` sekarang ikut tampil, jadi angka yang
                dibaca kasir harus menjelaskan selisihnya sendiri: berapa yang
                dikembalikan, dan berapa yang benar-benar tinggal di laci. */}
            <Table.Column className="text-right">{id.reports.column.returned}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.net}</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.receiptNumber}>
            <Table.Cell className="font-mono whitespace-nowrap">{row.receiptNumber}</Table.Cell>
            {/* Kasir di bawah tanggalnya dan jumlah item di bawah totalnya, seperti
                layar Riwayat: sebagai kolom sendiri, sembilan kolom tidak muat di
                area isi layar 1024px dan kolom Bersih — angka yang dicari di
                laporan ini — tergulir keluar. */}
            <Table.Cell className="whitespace-nowrap">
              <div className="flex flex-col">
                <span>{formatDayDate(row.createdAt)}</span>
                <span className="max-w-40 truncate text-xs text-muted">{row.cashierName}</span>
              </div>
            </Table.Cell>
            {/* Teks, bukan `Chip`: sepuluh lencana per layar berhenti berarti apa-apa.
                Lencana disimpan untuk kolom Status yang memang menyatakan keadaan. */}
            <Table.Cell className="whitespace-nowrap">
              {paymentMethodLabel(row.paymentMethod)}
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap">
              {/* Peta status/warna sebelumnya disalin di file ini; `@/lib/labels`
                  sudah jadi satu-satunya sumbernya untuk seluruh aplikasi. */}
              <StatusBadge size="sm" status={transactionStatusVariant(row.status)}>
                {transactionStatusLabel(row.status)}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-right whitespace-nowrap">
              <div className="flex flex-col items-end">
                <span>{formatRupiah(row.totalAmount)}</span>
                <span className="text-xs text-muted">{formatNumber(row.itemCount)} item</span>
              </div>
            </Table.Cell>
            <Table.Cell
              className={cn(
                "text-right whitespace-nowrap",
                row.refundAmount > 0 ? "text-danger" : "text-muted",
              )}
            >
              {row.refundAmount > 0 ? `-${formatRupiah(row.refundAmount)}` : "-"}
            </Table.Cell>
            <Table.Cell className="text-right font-medium whitespace-nowrap">
              {formatRupiah(row.netAmount)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
