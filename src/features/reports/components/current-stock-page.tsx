import { useState } from "react"
import { Table } from "@heroui/react"

import { id } from "@/i18n/id"
import { OptionSelect } from "@/components/option-select"
import { SearchInput } from "@/components/search-input"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useDebounce } from "@/hooks/use-debounce"
import { useCurrentStock } from "../hooks/use-reports"
import type { CurrentStockRow } from "../types"
import { ReportPage, ReportTable, StatSkeleton, TruncationNotice } from "./report-shell"

const TITLE = id.reports.title.currentStock
const COLUMN_COUNT = 7
const SEARCH_PLACEHOLDER = id.reports.searchProduct

type StockFilter = "all" | "low"

const FILTER_OPTIONS: { key: StockFilter; label: string }[] = [
  { key: "all", label: id.reports.stockFilterAll },
  { key: "low", label: id.reports.stockFilterLow },
]

/**
 * `stock <= min_stock` — the rule the backend's "Stok Menipis" filter uses
 * (`products::LOW_STOCK_SQL`). A product with no minimum still counts once it
 * runs out, so the card, the badges and the filtered list agree.
 */
function isLowStock(row: Pick<CurrentStockRow, "stock" | "minStock">): boolean {
  return row.stock <= row.minStock
}

export function CurrentStockPage() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<StockFilter>("all")
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, isFetching, error, refetch } = useCurrentStock(debouncedSearch, filter)

  const totals = data?.items.reduce(
    (acc, r) => ({
      lowStock: acc.lowStock + (isLowStock(r) ? 1 : 0),
      value: acc.value + r.stockValue,
    }),
    { lowStock: 0, value: 0 },
  )
  const query = debouncedSearch.trim()
  // The empty state names what narrowed the list: the search text, or the
  // low-stock filter (an empty "Stok Menipis" list is good news, not a miss).
  const emptyMessage = query
    ? id.noMatch.query("produk", query)
    : filter === "low"
      ? id.reports.empty.lowStock
      : id.reports.empty.products

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
          <OptionSelect
            aria-label={id.reports.stockFilterLabel}
            className="w-44"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(key) => setFilter((key as StockFilter) ?? "all")}
          />
        </>
      }
    >
      {(isLoading || (totals && data)) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label={id.reports.stat.totalProducts}
            value={data ? formatNumber(data.totalCount) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.lowStockProducts}
            tone={totals && totals.lowStock > 0 ? "danger" : "default"}
            value={totals ? formatNumber(totals.lowStock) : <StatSkeleton />}
          />
          <StatCard
            label={id.reports.stat.totalStockValue}
            value={totals ? formatRupiah(totals.value) : <StatSkeleton />}
          />
        </div>
      )}

      {/* Backend membatasi jumlah baris. Kartu di atas dihitung dari baris yang
          terkirim saja, jadi katakan apa adanya saat daftarnya terpotong. */}
      {data && (
        <TruncationNotice shown={data.items.length} total={data.totalCount} noun="produk">
          {id.reports.truncatedStockHint}
        </TruncationNotice>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        emptyMessage={emptyMessage}
        // Barcode di bawah nama produk dan satuan di sel Stok ("114 pcs"), seperti
        // daftar Produk: sebagai kolom sendiri, sembilan kolom tidak muat di area
        // isi layar 1024px — kolom Nilai Stok, jumlah yang dicari di laporan ini,
        // tergulir keluar, atau nama produk terjepit jadi empat baris.
        contentClassName="min-w-[800px]"
        columns={
          <>
            <Table.Column isRowHeader>{id.reports.column.product}</Table.Column>
            <Table.Column>{id.reports.column.category}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.stock}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.minStock}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.buyPrice}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.sellPrice}</Table.Column>
            <Table.Column className="text-right">{id.reports.column.stockValue}</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => {
          const isLow = isLowStock(row)
          const isOut = row.stock <= 0
          return (
            <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
              <Table.Cell>
                <div className="flex flex-col">
                  {/* `text-pretty`: satuan di ujung nama tidak terlipat sendirian. */}
                  <span className="font-medium text-pretty">{row.productName}</span>
                  {row.barcode ? (
                    <span className="font-mono text-xs text-muted">{row.barcode}</span>
                  ) : null}
                </div>
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted">
                {row.categoryName ?? "-"}
              </Table.Cell>
              {/* Bentuk yang sama dengan tabel Stok Rendah di dashboard: angkanya
                  di dalam lencana — peringatan bila menipis, error bila habis.
                  Satu penanda, bukan tiga (latar baris, angka tebal, lencana).
                  Kata "habis"/"menipis" untuk pembaca layar, karena bedanya
                  keduanya di layar hanya warna lencananya. */}
              <Table.Cell className="text-right whitespace-nowrap">
                {isLow ? (
                  <StatusBadge size="sm" status={isOut ? "error" : "warning"}>
                    {formatNumber(row.stock)}
                    <span className="sr-only">
                      {isOut ? id.reports.stockOutSr : id.reports.stockLowSr}
                    </span>
                  </StatusBadge>
                ) : (
                  formatNumber(row.stock)
                )}
                <span className="ms-1 text-xs text-muted">{row.unit}</span>
              </Table.Cell>
              <Table.Cell className="text-right text-muted">
                {formatNumber(row.minStock)}
              </Table.Cell>
              <Table.Cell className="text-right">{formatRupiah(row.buyPrice)}</Table.Cell>
              <Table.Cell className="text-right">{formatRupiah(row.sellPrice)}</Table.Cell>
              <Table.Cell className="text-right font-medium">
                {formatRupiah(row.stockValue)}
              </Table.Cell>
            </Table.Row>
          )
        })}
      </ReportTable>
    </ReportPage>
  )
}
