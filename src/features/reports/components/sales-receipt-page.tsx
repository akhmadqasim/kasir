import { useState } from "react"
import { Chip, SearchField, Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { StatusBadge } from "@/components/status-badge"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import {
  paymentMethodLabel,
  transactionStatusLabel,
  transactionStatusVariant,
} from "@/lib/labels"
import { useDebounce } from "@/hooks/use-debounce"
import { useSalesReceipt } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Penjualan per Struk"
const COLUMN_COUNT = 7
const SEARCH_PLACEHOLDER = "Cari no. struk..."

export function SalesReceiptPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = useSalesReceipt(startDate, endDate, debouncedSearch)

  return (
    <ReportPage
      title={TITLE}
      filters={
        <>
          <SearchField
            aria-label={SEARCH_PLACEHOLDER}
            className="w-64"
            value={search}
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={SEARCH_PLACEHOLDER} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </>
      }
    >
      {data && data.items.length < data.totalCount && (
        <p className="text-sm text-muted">
          Menampilkan {data.items.length} dari {data.totalCount} struk. Persempit rentang
          tanggal atau pencarian untuk melihat sisanya.
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
          </>
        }
      >
        {(data?.items ?? []).map((row) => (
          <Table.Row key={row.id} id={row.id} textValue={row.receiptNumber}>
            <Table.Cell className="font-mono text-sm">{row.receiptNumber}</Table.Cell>
            <Table.Cell>{row.cashierName}</Table.Cell>
            <Table.Cell className="text-sm text-muted">
              {formatDayDate(row.createdAt)}
            </Table.Cell>
            <Table.Cell className="text-right">{row.itemCount}</Table.Cell>
            <Table.Cell>
              <Chip size="sm">{paymentMethodLabel(row.paymentMethod)}</Chip>
            </Table.Cell>
            <Table.Cell>
              {/* Peta status/warna sebelumnya disalin di file ini; `@/lib/labels`
                  sudah jadi satu-satunya sumbernya untuk seluruh aplikasi. */}
              <StatusBadge status={transactionStatusVariant(row.status)}>
                {transactionStatusLabel(row.status)}
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-right font-medium">
              {formatRupiah(row.totalAmount)}
            </Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
