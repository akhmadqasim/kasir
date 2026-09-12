import { useState } from "react"
import { Table } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { SearchInput } from "@/components/search-input"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useDebounce } from "@/hooks/use-debounce"
import { useCurrentStock } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Stok Saat Ini"
const COLUMN_COUNT = 9
const SEARCH_PLACEHOLDER = "Cari produk..."

type StockFilter = "all" | "low"

const FILTER_OPTIONS: { key: StockFilter; label: string }[] = [
  { key: "all", label: "Semua Produk" },
  { key: "low", label: "Stok Menipis" },
]

export function CurrentStockPage() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<StockFilter>("all")
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, error } = useCurrentStock(debouncedSearch, filter)

  const totals = data?.items.reduce(
    (acc, r) => ({
      lowStock: acc.lowStock + (r.stock <= r.minStock && r.minStock > 0 ? 1 : 0),
      value: acc.value + r.stockValue,
    }),
    { lowStock: 0, value: 0 },
  )
  // Backend membatasi jumlah baris. Kartu di bawah dihitung dari baris yang
  // terkirim saja, jadi katakan apa adanya saat daftarnya terpotong.
  const isTruncated = !!data && data.items.length < data.totalCount

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
          <OptionSelect
            aria-label="Saring stok"
            className="w-44"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(key) => setFilter((key as StockFilter) ?? "all")}
          />
        </>
      }
    >
      {totals && data && (
        <div className="flex flex-col gap-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total Produk" value={formatNumber(data.totalCount)} />
            <StatCard
              label="Produk Stok Menipis"
              tone="danger"
              value={formatNumber(totals.lowStock)}
            />
            <StatCard label="Total Nilai Stok" value={formatRupiah(totals.value)} />
          </div>
          {isTruncated && (
            <p className="text-sm text-muted">
              Menampilkan {data.items.length} dari {data.totalCount} produk. Kartu stok menipis dan
              nilai stok dihitung dari baris yang tampil saja — persempit pencarian untuk angka yang
              utuh.
            </p>
          )}
        </div>
      )}

      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        contentClassName="min-w-[1100px]"
        columns={
          <>
            <Table.Column isRowHeader>Produk</Table.Column>
            <Table.Column>Barcode</Table.Column>
            <Table.Column>Kategori</Table.Column>
            <Table.Column className="text-right">Stok</Table.Column>
            <Table.Column className="text-right">Min. Stok</Table.Column>
            <Table.Column>Satuan</Table.Column>
            <Table.Column className="text-right">Harga Beli</Table.Column>
            <Table.Column className="text-right">Harga Jual</Table.Column>
            <Table.Column className="text-right">Nilai Stok</Table.Column>
          </>
        }
      >
        {(data?.items ?? []).map((row) => {
          const isLow = row.stock <= row.minStock && row.minStock > 0
          return (
            <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
              <Table.Cell className="font-medium">{row.productName}</Table.Cell>
              <Table.Cell className="font-mono text-muted">{row.barcode ?? "-"}</Table.Cell>
              <Table.Cell className="text-muted">{row.categoryName ?? "-"}</Table.Cell>
              {/* Bentuk yang sama dengan tabel Stok Rendah di dashboard: angkanya
                  di dalam lencana — peringatan bila menipis, error bila habis.
                  Satu penanda, bukan tiga (latar baris, angka tebal, lencana). */}
              <Table.Cell className="text-right">
                {isLow ? (
                  <StatusBadge size="sm" status={row.stock === 0 ? "error" : "warning"}>
                    {row.stock}
                  </StatusBadge>
                ) : (
                  row.stock
                )}
              </Table.Cell>
              <Table.Cell className="text-right text-muted">{row.minStock}</Table.Cell>
              <Table.Cell>{row.unit}</Table.Cell>
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
