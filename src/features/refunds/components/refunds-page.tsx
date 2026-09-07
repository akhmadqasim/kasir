import { useState, useCallback, useMemo } from "react"
import { Eye, X } from "lucide-react"
import { Button, Label, ListBox, Select, Skeleton, Table } from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { DateRangePicker } from "@/components/date-range-picker"
import { getTodayRange, type DateRange } from "@/lib/date-range"
import { useApiQuery } from "@/hooks/use-api"
import { listRefunds } from "@/lib/api/refunds"
import { queryKeys } from "@/lib/api/query-keys"
import { formatDateTime, formatRupiah, toLocalDateString } from "@/lib/format"
import { id } from "@/i18n/id"
import { differenceToneClass, refundTypeLabel, refundTypeVariant } from "../labels"
import { RefundDetailDialog } from "./refund-detail-dialog"
import type { ListRefundsInput, ListRefundsResult } from "../types"

/** Nilai sentinel `Select`: React Aria memakai `null` untuk "tidak ada pilihan". */
const ALL = "all"

const TYPE_FILTERS = [
  { key: ALL, label: id.refund.allTypes },
  { key: "refund", label: id.refund.typeRefund },
  { key: "exchange", label: id.refund.typeExchange },
] as const

const COLUMN_COUNT = 9

export function RefundsPage() {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState("")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getTodayRange)
  const [detailRefundId, setDetailRefundId] = useState<number | null>(null)

  const queryParams = useMemo<ListRefundsInput>(
    () => ({
      page,
      per_page: 50,
      refund_type: typeFilter || undefined,
      date_from: dateRange?.from ? toLocalDateString(dateRange.from) : undefined,
      date_to: dateRange?.to ? toLocalDateString(dateRange.to) : undefined,
    }),
    [page, typeFilter, dateRange],
  )

  const { data, isLoading, error } = useApiQuery<ListRefundsResult>(
    queryKeys.refunds.list(queryParams),
    () => listRefunds(queryParams),
  )

  const resetFilters = useCallback(() => {
    setTypeFilter("")
    setDateRange(getTodayRange())
    setPage(1)
  }, [])

  const today = toLocalDateString(new Date())
  const hasFilters =
    typeFilter ||
    (dateRange?.from && toLocalDateString(dateRange.from) !== today) ||
    (dateRange?.to && toLocalDateString(dateRange.to) !== today)

  const refunds = data?.items ?? []

  const renderEmptyState = () => {
    if (error) {
      return <p className="py-10 text-center text-danger">Error: {error.message}</p>
    }
    return <p className="py-10 text-center text-muted">{id.refund.noRefunds}</p>
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">{id.refund.history}</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label={id.refund.allTypes}
          className="w-48"
          placeholder={id.refund.allTypes}
          value={typeFilter || ALL}
          onChange={(value) => {
            setTypeFilter(value === ALL ? "" : String(value))
            setPage(1)
          }}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {TYPE_FILTERS.map((option) => (
                <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        {hasFilters && (
          <Button size="sm" variant="tertiary" onPress={resetFilters}>
            <X className="mr-1 h-4 w-4" />
            {id.transactions.resetFilter}
          </Button>
        )}

        <div className="ml-auto">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => {
              setDateRange(range)
              setPage(1)
            }}
            align="start"
          />
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label={id.refund.history}>
              <Table.Header>
                <Table.Column isRowHeader>{id.refund.refundNumber}</Table.Column>
                <Table.Column>{id.refund.transactionReceipt}</Table.Column>
                <Table.Column>{id.refund.type}</Table.Column>
                <Table.Column className="text-right">{id.refund.totalRefund}</Table.Column>
                <Table.Column className="text-right">{id.refund.totalExchange}</Table.Column>
                <Table.Column className="text-right">{id.refund.difference}</Table.Column>
                <Table.Column>{id.refund.cashier}</Table.Column>
                <Table.Column>{id.transactions.date}</Table.Column>
                <Table.Column className="w-24 text-right">
                  <span className="sr-only">Aksi</span>
                </Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={renderEmptyState}>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, rowIndex) => (
                      <Table.Row key={`skeleton-${rowIndex}`} id={`skeleton-${rowIndex}`}>
                        {Array.from({ length: COLUMN_COUNT }).map((_, cellIndex) => (
                          <Table.Cell key={cellIndex}>
                            <Skeleton className="h-5 w-full" />
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))
                  : refunds.map((item) => (
                      <Table.Row
                        key={item.id}
                        id={item.id}
                        textValue={item.refund_number}
                        onAction={() => setDetailRefundId(item.id)}
                      >
                        <Table.Cell className="font-mono text-sm">{item.refund_number}</Table.Cell>
                        <Table.Cell className="font-mono text-sm">
                          {item.transaction_receipt}
                        </Table.Cell>
                        <Table.Cell>
                          <StatusBadge status={refundTypeVariant(item.refund_type)}>
                            {refundTypeLabel(item.refund_type)}
                          </StatusBadge>
                        </Table.Cell>
                        <Table.Cell className="text-right tabular-nums">
                          {formatRupiah(item.total_refund_amount)}
                        </Table.Cell>
                        <Table.Cell className="text-right tabular-nums">
                          {item.refund_type === "exchange"
                            ? formatRupiah(item.total_exchange_amount)
                            : "—"}
                        </Table.Cell>
                        <Table.Cell
                          className={`text-right tabular-nums ${differenceToneClass(item.difference_amount)}`}
                        >
                          {item.refund_type === "exchange"
                            ? formatRupiah(item.difference_amount)
                            : "—"}
                        </Table.Cell>
                        <Table.Cell>{item.cashier_name}</Table.Cell>
                        <Table.Cell className="text-sm">
                          {formatDateTime(item.created_at)}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <Button
                            aria-label={id.refund.detail}
                            isIconOnly
                            size="sm"
                            variant="secondary"
                            onPress={() => setDetailRefundId(item.id)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <TablePagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />

      <RefundDetailDialog refundId={detailRefundId} onClose={() => setDetailRefundId(null)} />
    </div>
  )
}
