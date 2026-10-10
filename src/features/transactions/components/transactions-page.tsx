import { useState, useCallback, useMemo } from "react"
import { ReceiptText, RefreshCw, X } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import { Alert, Button, Spinner } from "@heroui/react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { TablePagination } from "@/components/table-pagination"
import { useApiQuery } from "@/hooks/use-api"
import { useDebounce } from "@/hooks/use-debounce"
import { listTransactions } from "@/lib/api/transactions"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import {
  defaultTransactionFilters,
  hasActiveFilters,
  PPOB_UNCERTAIN_FILTER,
  ppobAttentionFilters,
  transactionListParams,
  type TransactionFilters,
} from "../transaction-filters"
import { usePpobAttention } from "../hooks/use-ppob-attention"
import type { PaginatedTransactions, TransactionListItem } from "../types"
import { TransactionDetailDialog } from "./transaction-detail-dialog"
import { TransactionFilterBar } from "./transaction-filter-bar"
import { TransactionsTable } from "./transactions-table"

export function TransactionsPage() {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState(defaultTransactionFilters)
  const debouncedSearch = useDebounce(filters.search, 300)
  const [detailTxn, setDetailTxn] = useState<TransactionListItem | null>(null)

  const queryParams = useMemo(
    () => transactionListParams(filters, debouncedSearch, page),
    [filters, debouncedSearch, page],
  )

  const { data, isLoading, isPlaceholderData, isFetching, error, refetch } =
    useApiQuery<PaginatedTransactions>(
      queryKeys.transactions.list(queryParams),
      () => listTransactions(queryParams),
      { placeholderData: keepPreviousData },
    )

  // A reload (a refund or delete elsewhere) can shrink the list below the
  // current page. Without this that page shows empty, and with one page left
  // the pager disappears too, leaving no way back.
  const lastPage = data && !isPlaceholderData ? Math.max(1, data.total_pages) : null
  if (lastPage != null && page > lastPage) setPage(lastPage)

  // Any filter change starts over at the first page.
  const updateFilters = useCallback((patch: Partial<TransactionFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(1)
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(defaultTransactionFilters())
    setPage(1)
  }, [])

  const hasFilters = hasActiveFilters(filters)

  // PPOB lines still waiting on an answer can be days old; today's list would
  // never show them. One press lists them all ("Perlu dicek", every day).
  const ppobAttention = usePpobAttention()
  const showPpobAttention = ppobAttention > 0 && filters.status !== PPOB_UNCERTAIN_FILTER
  const showPpobAttentionList = useCallback(() => {
    setFilters(ppobAttentionFilters())
    setPage(1)
  }, [])

  const renderEmptyState = () =>
    error ? (
      <LoadError
        isRetrying={isFetching}
        title={id.loadFailed.transactions}
        onRetry={() => refetch()}
      >
        {error.message}
      </LoadError>
    ) : hasFilters ? (
      <NoData
        action={
          <Button size="sm" variant="secondary" onPress={resetFilters}>
            <X />
            {id.common.clearFilters}
          </Button>
        }
        icon={<ReceiptText />}
        title={id.noMatch.transactions}
      >
        Coba ubah kata kunci, filter, atau rentang tanggalnya.
      </NoData>
    ) : (
      <NoData icon={<ReceiptText />} title={id.transactions.noTransactions}>
        Transaksi hari ini akan muncul di sini setelah ada penjualan.
      </NoData>
    )

  return (
    // DESIGN.md §5.1
    <div className="flex h-full flex-col gap-4">
      {/* Muat ulang di navbar — DESIGN.md §5.1. Spinner-nya juga satu-satunya
          tanda bahwa filter baru sedang dimuat: `keepPreviousData` membiarkan
          baris lama tetap tampil sampai hasilnya datang. */}
      <NavbarActions>
        <Button
          aria-label={id.common.reload}
          isIconOnly
          isPending={isFetching}
          size="sm"
          variant="tertiary"
          onPress={() => refetch()}
        >
          {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />)}
        </Button>
      </NavbarActions>

      {showPpobAttention && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{id.transactions.ppobAttentionCount(ppobAttention)}</Alert.Title>
            <Alert.Description>{id.transactions.ppobAttentionHint}</Alert.Description>
          </Alert.Content>
          <Button
            className="shrink-0"
            size="sm"
            variant="secondary"
            onPress={showPpobAttentionList}
          >
            {id.transactions.ppobAttentionShow}
          </Button>
        </Alert>
      )}

      <TransactionFilterBar
        filters={filters}
        onChange={updateFilters}
        onReset={hasFilters ? resetFilters : undefined}
      />

      <div className="min-h-0 flex-1">
        <TransactionsTable
          isLoading={isLoading}
          renderEmptyState={renderEmptyState}
          transactions={data?.data ?? []}
          onOpenDetail={setDetailTxn}
        />
      </div>

      <TablePagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />

      <TransactionDetailDialog transaction={detailTxn} onClose={() => setDetailTxn(null)} />
    </div>
  )
}
