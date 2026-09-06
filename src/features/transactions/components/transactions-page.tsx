import { useState, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, Printer, RotateCcw, X } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import {
  Button,
  Chip,
  Label,
  ListBox,
  SearchField,
  Select,
  Skeleton,
  Table,
  Tooltip,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { selectedText } from "@/components/selected-text"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { DateRangePicker } from "@/components/date-range-picker"
import { getTodayRange, type DateRange } from "@/lib/date-range"
import { useApiQuery } from "@/hooks/use-api"
import { listTransactions } from "@/lib/api/transactions"
import { printReceipt } from "@/lib/api/printers"
import { queryKeys } from "@/lib/api/query-keys"
import { useDebounce } from "@/hooks/use-debounce"
import { formatDateTime, formatRupiah, toLocalDateString } from "@/lib/format"
import { paymentMethodLabel, transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { id } from "@/i18n/id"
import { refundBlockedReason } from "../refund-window"
import { TransactionDetailDialog } from "./transaction-detail-dialog"
import type { ListTransactionsInput, PaginatedTransactions, TransactionListItem } from "../types"

/** Nilai sentinel `Select`: React Aria memakai `null` untuk "tidak ada pilihan". */
const ALL = "all"

const PAYMENT_METHOD_FILTERS = [
  { key: ALL, label: id.transactions.allMethods },
  { key: "cash", label: id.payment.cash },
  { key: "qris", label: id.payment.qris },
  { key: "debit", label: id.payment.debit },
  { key: "ewallet", label: id.payment.ewallet },
  { key: "transfer", label: id.payment.transfer },
  { key: "mixed", label: id.payment.mixed },
] as const

const STATUS_FILTERS = [
  { key: ALL, label: id.transactions.allStatus },
  { key: "completed", label: id.transactions.completed },
  { key: "pending_ppob", label: id.transactions.pendingPpob },
  { key: "ppob_failed", label: id.transactions.ppobFailed },
  { key: "refunded", label: id.transactions.refunded },
  { key: "partial_refund", label: id.transactions.partialRefund },
  { key: "deleted", label: id.transactions.deleted },
] as const

const COLUMN_COUNT = 9

/**
 * The refund entry point for one row.
 *
 * A disabled button swallows pointer events, so the tooltip has to hang off a
 * wrapper: without it the cashier sees a dead button and no reason for it.
 * HeroUI's `Tooltip.Trigger` renders that wrapper as `div[role=button]
 * [tabindex=0]`, which is what finally makes the reason reachable by keyboard —
 * the old `<span>` wrapper was invisible to anyone not using a mouse.
 */
function RefundActionButton({
  blockedReason,
  onPress,
}: {
  blockedReason: string | null
  onPress: () => void
}) {
  const button = (
    <Button
      aria-label={blockedReason ?? id.refund.title}
      isDisabled={blockedReason !== null}
      isIconOnly
      size="sm"
      variant="ghost"
      onPress={onPress}
    >
      <RotateCcw className="h-4 w-4" />
    </Button>
  )

  if (!blockedReason) return button

  return (
    <Tooltip>
      <Tooltip.Trigger className="inline-flex">{button}</Tooltip.Trigger>
      <Tooltip.Content>{blockedReason}</Tooltip.Content>
    </Tooltip>
  )
}

function getTransactionDescription(txn: TransactionListItem): string {
  if (txn.deleted_reason?.trim()) {
    return `Alasan hapus: ${txn.deleted_reason.trim()}`
  }

  if (txn.notes?.trim()) {
    return txn.notes.trim()
  }

  if (txn.ppob_message?.trim()) {
    return txn.ppob_message.trim()
  }

  return "—"
}

export function TransactionsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)
  const [paymentMethod, setPaymentMethod] = useState("")
  const [status, setStatus] = useState("")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getTodayRange)
  const [detailTxn, setDetailTxn] = useState<TransactionListItem | null>(null)

  const queryParams = useMemo<ListTransactionsInput>(
    () => ({
      page,
      per_page: 50,
      search: debouncedSearch || undefined,
      payment_method: paymentMethod || undefined,
      status: status || undefined,
      date_from: dateRange?.from ? toLocalDateString(dateRange.from) : undefined,
      date_to: dateRange?.to ? toLocalDateString(dateRange.to) : undefined,
    }),
    [page, debouncedSearch, paymentMethod, status, dateRange],
  )

  const { data, isLoading, error } = useApiQuery<PaginatedTransactions>(
    queryKeys.transactions.list(queryParams),
    () => listTransactions(queryParams),
    { placeholderData: keepPreviousData },
  )

  // Printing happens on the server: the thermal printer is plugged into the till
  // the server runs on, so this produces paper there whichever device pressed it.
  const handlePrint = useCallback(async (transactionId: number) => {
    try {
      await printReceipt(transactionId)
      toast.success("Struk dicetak")
    } catch (e) {
      toast.error(`Gagal cetak: ${e instanceof Error ? e.message : e}`)
    }
  }, [])

  const resetFilters = useCallback(() => {
    setSearch("")
    setPaymentMethod("")
    setStatus("")
    setDateRange(getTodayRange())
    setPage(1)
  }, [])

  const today = toLocalDateString(new Date())
  const hasFilters =
    search ||
    paymentMethod ||
    status ||
    (dateRange?.from && toLocalDateString(dateRange.from) !== today) ||
    (dateRange?.to && toLocalDateString(dateRange.to) !== today)

  const transactions = data?.data ?? []

  const renderEmptyState = () => {
    if (error) {
      return <p className="py-10 text-center text-danger">Error: {error.message}</p>
    }
    return <p className="py-10 text-center text-muted">{id.transactions.noTransactions}</p>
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">{id.transactions.title}</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          aria-label={id.transactions.searchPlaceholder}
          className="w-64"
          value={search}
          onChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={id.transactions.searchPlaceholder} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Select
          aria-label={id.transactions.allMethods}
          className="w-48"
          placeholder={id.transactions.allMethods}
          value={paymentMethod || ALL}
          onChange={(value) => {
            setPaymentMethod(value === ALL ? "" : String(value))
            setPage(1)
          }}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PAYMENT_METHOD_FILTERS.map((option) => (
                <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Select
          aria-label={id.transactions.allStatus}
          className="w-48"
          placeholder={id.transactions.allStatus}
          value={status || ALL}
          onChange={(value) => {
            setStatus(value === ALL ? "" : String(value))
            setPage(1)
          }}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {STATUS_FILTERS.map((option) => (
                <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        {hasFilters && (
          <Button size="sm" variant="ghost" onPress={resetFilters}>
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
            <Table.Content aria-label={id.transactions.title} className="min-w-[1180px]">
              <Table.Header>
                <Table.Column isRowHeader>{id.transactions.receiptNumber}</Table.Column>
                <Table.Column>{id.transactions.cashier}</Table.Column>
                <Table.Column>{id.transactions.date}</Table.Column>
                <Table.Column className="text-center">{id.transactions.items}</Table.Column>
                <Table.Column>{id.transactions.paymentMethod}</Table.Column>
                <Table.Column>{id.transactions.description}</Table.Column>
                <Table.Column>{id.transactions.status}</Table.Column>
                <Table.Column className="text-right">{id.transactions.totalAmount}</Table.Column>
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
                  : transactions.map((txn) => (
                      <Table.Row
                        key={txn.id}
                        id={txn.id}
                        className={txn.status === "deleted" ? "opacity-50" : undefined}
                        textValue={txn.receipt_number}
                        onAction={() => setDetailTxn(txn)}
                      >
                        <Table.Cell className="font-mono text-sm">
                          <div className="space-y-1">
                            <p>{txn.receipt_number}</p>
                            {txn.ppob_message && (
                              <p className="max-w-48 truncate text-xs text-muted">
                                {txn.ppob_message}
                              </p>
                            )}
                          </div>
                        </Table.Cell>
                        <Table.Cell>{txn.cashier_name}</Table.Cell>
                        <Table.Cell className="text-sm">
                          {formatDateTime(txn.created_at)}
                        </Table.Cell>
                        <Table.Cell className="text-center">{txn.item_count}</Table.Cell>
                        <Table.Cell>
                          <Chip size="sm">{paymentMethodLabel(txn.payment_method)}</Chip>
                        </Table.Cell>
                        <Table.Cell className="max-w-64 whitespace-normal">
                          <p className="break-words text-sm text-muted">
                            {getTransactionDescription(txn)}
                          </p>
                        </Table.Cell>
                        <Table.Cell>
                          <StatusBadge status={transactionStatusVariant(txn.status)}>
                            {transactionStatusLabel(txn.status)}
                          </StatusBadge>
                        </Table.Cell>
                        <Table.Cell className="text-right font-semibold tabular-nums">
                          {formatRupiah(txn.total_amount)}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              aria-label={id.transactions.detail}
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => setDetailTxn(txn)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!txn.has_ppob &&
                              txn.status !== "refunded" &&
                              txn.status !== "deleted" && (
                                <RefundActionButton
                                  blockedReason={refundBlockedReason(txn.created_at)}
                                  onPress={() => navigate(`/refund/${txn.id}`)}
                                />
                              )}
                            <Button
                              aria-label={id.transactions.printReceipt}
                              isDisabled={
                                txn.has_ppob &&
                                txn.status !== "completed" &&
                                txn.status !== "deleted"
                              }
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => handlePrint(txn.id)}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <TablePagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />

      <TransactionDetailDialog transaction={detailTxn} onClose={() => setDetailTxn(null)} />
    </div>
  )
}
