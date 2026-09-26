import { useState, useCallback, useMemo } from "react"
import { Eye, RefreshCw, Undo2, X } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import { Button, Spinner, Table } from "@heroui/react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { OptionSelect } from "@/components/option-select"
import { TablePagination } from "@/components/table-pagination"
import { DateRangePicker } from "@/components/date-range-picker"
import { getTodayRange, type DateRange } from "@/lib/date-range"
import { useApiQuery } from "@/hooks/use-api"
import { listRefunds } from "@/lib/api/refunds"
import { queryKeys } from "@/lib/api/query-keys"
import { formatDateTime, formatRupiah, toLocalDateString } from "@/lib/format"
import { id } from "@/i18n/id"
import { differenceDirectionLabel, differenceToneClass, refundTypeLabel } from "../labels"
import { RefundDetailDialog } from "./refund-detail-dialog"
import type { ListRefundsInput, ListRefundsResult } from "../types"

/** Nilai sentinel `Select`: React Aria memakai `null` untuk "tidak ada pilihan". */
const ALL = "all"

const TYPE_FILTERS = [
  { key: ALL, label: id.refund.allTypes },
  { key: "refund", label: id.refund.typeRefund },
  { key: "exchange", label: id.refund.typeExchange },
] as const

const COLUMN_COUNT = 7

/**
 * Sel aksi yang menempel di kanan, dengan latar pekat halaman dan warna hover
 * barisnya sendiri — sama seperti di tabel Riwayat.
 */
const STICKY_ACTIONS_CELL =
  "sticky right-0 bg-background text-right [tr:hover>&]:bg-[color-mix(in_oklab,var(--default)_50%,var(--background))]"

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

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<ListRefundsResult>(
    queryKeys.refunds.list(queryParams),
    () => listRefunds(queryParams),
    // Ganti halaman atau filter tanpa tabel berkedip jadi kerangka lagi.
    { placeholderData: keepPreviousData },
  )

  const resetFilters = useCallback(() => {
    setTypeFilter("")
    setDateRange(getTodayRange())
    setPage(1)
  }, [])

  const today = toLocalDateString(new Date())
  const hasFilters =
    typeFilter !== "" ||
    (!!dateRange?.from && toLocalDateString(dateRange.from) !== today) ||
    (!!dateRange?.to && toLocalDateString(dateRange.to) !== today)

  const refunds = data?.items ?? []

  const renderEmptyState = () =>
    error ? (
      <LoadError isRetrying={isFetching} title={id.loadFailed.refunds} onRetry={() => refetch()}>
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
        icon={<Undo2 />}
        title={id.noMatch.refunds}
      >
        Coba ubah tipe atau rentang tanggalnya.
      </NoData>
    ) : (
      <NoData icon={<Undo2 />} title={id.refund.noRefunds}>
        Refund dan tukar barang dibuat dari Riwayat Transaksi.
      </NoData>
    )

  return (
    // DESIGN.md §5.1
    <div className="flex h-full flex-col gap-4">
      {/* Muat ulang di navbar — DESIGN.md §5.1. */}
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          aria-label={id.refund.type}
          className="w-48"
          placeholder={id.refund.allTypes}
          options={TYPE_FILTERS}
          value={typeFilter || ALL}
          onChange={(key) => {
            setTypeFilter(key === ALL || key === null ? "" : key)
            setPage(1)
          }}
        />

        {hasFilters && (
          <Button size="sm" variant="tertiary" onPress={resetFilters}>
            <X />
            {id.common.clearFilters}
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

      {/* Table — its own scroller on both axes, like the transaction history:
          the header stays put and the horizontal scrollbar stays on screen. */}
      <div className="min-h-0 flex-1">
        <Table className="h-full grid-rows-[minmax(0,1fr)]" variant="secondary">
          <Table.ScrollContainer className="overflow-auto">
            <Table.Content
              aria-label={id.refund.history}
              className="tabular-nums [&_th]:whitespace-nowrap [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10"
            >
              <Table.Header>
                <Table.Column isRowHeader>
                  {id.refund.refundNumber} / {id.refund.type}
                </Table.Column>
                <Table.Column>{id.refund.transactionReceipt}</Table.Column>
                <Table.Column className="text-right">{id.refund.totalRefund}</Table.Column>
                <Table.Column className="text-right">{id.refund.totalExchange}</Table.Column>
                <Table.Column className="text-right">{id.refund.difference}</Table.Column>
                <Table.Column>
                  {id.transactions.date} / {id.refund.cashier}
                </Table.Column>
                {/* Aksi menempel di kanan: di 1024px tabelnya lebih lebar dari layar. */}
                <Table.Column className="right-0 w-24 text-right">
                  <span className="sr-only">Aksi</span>
                </Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={renderEmptyState}>
                {isLoading ? (
                  <TableSkeletonRows columns={COLUMN_COUNT} rows={5} />
                ) : (
                  refunds.map((item) => (
                    <Table.Row
                      key={item.id}
                      id={item.id}
                      textValue={item.refund_number}
                      onAction={() => setDetailRefundId(item.id)}
                    >
                      {/* Tipe di bawah nomornya sebagai teks, bukan lencana: kategori
                          yang ada di setiap baris, bukan status — DESIGN.md §5.4.
                          Satu kolom lebih sedikit, jadi tabelnya muat di 1024px. */}
                      <Table.Cell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-mono">{item.refund_number}</span>
                          <span className="text-xs text-muted">
                            {refundTypeLabel(item.refund_type)}
                          </span>
                        </div>
                      </Table.Cell>
                      <Table.Cell className="font-mono whitespace-nowrap">
                        {item.transaction_receipt}
                      </Table.Cell>
                      <Table.Cell className="text-right font-medium whitespace-nowrap">
                        {formatRupiah(item.total_refund_amount)}
                      </Table.Cell>
                      <Table.Cell className="text-right whitespace-nowrap">
                        {item.refund_type === "exchange" ? (
                          formatRupiah(item.total_exchange_amount)
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-right whitespace-nowrap">
                        {item.refund_type === "exchange" ? (
                          // Arahnya ditulis, bukan hanya diwarnai: hijau/merah saja
                          // tidak terbaca oleh yang buta warna.
                          <div className="flex flex-col items-end">
                            <span className={differenceToneClass(item.difference_amount)}>
                              {formatRupiah(Math.abs(item.difference_amount))}
                            </span>
                            {differenceDirectionLabel(item.difference_amount) && (
                              <span className="text-xs text-muted">
                                {differenceDirectionLabel(item.difference_amount)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Table.Cell>
                      {/* Kasir di bawah waktunya, seperti di Riwayat: satu kolom
                          lebih sedikit, jadi tabelnya muat di 1366px. */}
                      <Table.Cell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span>{formatDateTime(item.created_at)}</span>
                          <span className="max-w-40 truncate text-xs text-muted">
                            {item.cashier_name}
                          </span>
                        </div>
                      </Table.Cell>
                      <Table.Cell className={STICKY_ACTIONS_CELL}>
                        <Button
                          aria-label={`Lihat detail ${item.refund_number}`}
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          onPress={() => setDetailRefundId(item.id)}
                        >
                          <Eye />
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
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
