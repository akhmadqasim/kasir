import { useState } from "react"
import { Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { SearchInput } from "@/components/search-input"
import { StatusBadge } from "@/components/status-badge"
import { formatDayDate, formatRupiah } from "@/lib/format"
import { paymentMethodLabel, transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { useDebounce } from "@/hooks/use-debounce"
import { useReportDateRange } from "../hooks/use-report-date-range"
import { useSalesReceipt } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Penjualan per Struk"
const COLUMN_COUNT = 9
const SEARCH_PLACEHOLDER = "Cari no. struk..."

export function SalesReceiptPage() {
  const { dateRange, setDateRange, startDate, endDate } = useReportDateRange()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, error } = useSalesReceipt(startDate, endDate, debouncedSearch)

  return (
    <ReportPage
      filters={
        <>
          <SearchInput
            aria-label={SEARCH_PLACEHOLDER}
            placeholder={SEARCH_PLACEHOLDER}
            className="w-64"
            value={search}
            onChange={setSearch}
          />
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </>
      }
    >
      {data && data.items.length < data.totalCount && (
        <p className="text-sm text-muted">
          Menampilkan {data.items.length} dari {data.totalCount} struk. Persempit rentang tanggal
          atau pencarian untuk melihat sisanya.
        </p>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        columns={
          <>
            <Table.Column isRowHeader>No. Struk</Table.Column>
            <Table.Column>Kasir</Table.Column>
            <Table.Column>Tanggal</Table.Column>
            <Table.Column className="text-right">Item</Table.Column>
            <Table.Column>Metode Bayar</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column className="text-right">Total</Table.Column>
            {/* Struk berstatus `refunded` sekarang ikut tampil, jadi angka yang
                dibaca kasir harus menjelaskan selisihnya sendiri: berapa yang
                dikembalikan, dan berapa yang benar-benar tinggal di laci. */}
            <Table.Column className="text-right">Retur</Table.Column>
            <Table.Column className="text-right">Bersih</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.receiptNumber}>
            <Table.Cell className="font-mono">{row.receiptNumber}</Table.Cell>
            <Table.Cell>{row.cashierName}</Table.Cell>
            <Table.Cell className="text-muted">{formatDayDate(row.createdAt)}</Table.Cell>
            <Table.Cell className="text-right">{row.itemCount}</Table.Cell>
            {/* Teks, bukan `Chip`: sepuluh lencana per layar berhenti berarti apa-apa.
                Lencana disimpan untuk kolom Status yang memang menyatakan keadaan. */}
            <Table.Cell>{paymentMethodLabel(row.paymentMethod)}</Table.Cell>
            <Table.Cell>
              {/* Peta status/warna sebelumnya disalin di file ini; `@/lib/labels`
                  sudah jadi satu-satunya sumbernya untuk seluruh aplikasi. */}
              <StatusBadge status={transactionStatusVariant(row.status)}>
                {transactionStatusLabel(row.status)}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalAmount)}</Table.Cell>
            <Table.Cell
              className={`text-right ${row.refundAmount > 0 ? "text-danger" : "text-muted"}`}
            >
              {row.refundAmount > 0 ? `-${formatRupiah(row.refundAmount)}` : "-"}
            </Table.Cell>
            <Table.Cell className="text-right font-medium">
              {formatRupiah(row.netAmount)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
