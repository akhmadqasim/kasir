import { useState } from "react"
import { Label, ListBox, Select, Table } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { selectedText } from "@/components/selected-text"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { formatRupiah, toLocalDateString } from "@/lib/format"
import { usePopularProducts } from "../hooks/use-reports"
import { ReportPage, ReportTable } from "./report-shell"

const TITLE = "Produk Populer"
const COLUMN_COUNT = 5

const rankEmoji = ["🥇", "🥈", "🥉"]

const LIMIT_OPTIONS = [
  { key: "10", label: "Top 10" },
  { key: "20", label: "Top 20" },
  { key: "50", label: "Top 50" },
] as const

export function PopularProductsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)
  const [limit, setLimit] = useState(20)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading, error } = usePopularProducts(startDate, endDate, limit)

  return (
    <ReportPage
      filters={
        <>
          <Select
            aria-label="Jumlah produk teratas"
            className="w-32"
            value={String(limit)}
            onChange={(value) => setLimit(Number(value))}
          >
            <Select.Trigger>
              <Select.Value>{selectedText}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {LIMIT_OPTIONS.map((option) => (
                  <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                    <Label>{option.label}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </>
      }
    >
      <ReportTable
        label={TITLE}
        columnCount={COLUMN_COUNT}
        isLoading={isLoading}
        error={error}
        columns={
          <>
            <Table.Column className="w-16">Rank</Table.Column>
            <Table.Column isRowHeader>Produk</Table.Column>
            <Table.Column>Kategori</Table.Column>
            <Table.Column className="text-right">Qty Terjual</Table.Column>
            <Table.Column className="text-right">Total Pendapatan</Table.Column>
          </>
        }
      >
        {(data ?? []).map((row) => (
          <Table.Row key={row.productId} id={row.productId} textValue={row.productName}>
            <Table.Cell>
              {/* Medali hanya hiasan peringkat; nomornya tetap dibacakan pembaca layar. */}
              <span className="font-medium">
                {row.rank <= 3 ? (
                  <>
                    <span aria-hidden="true">{rankEmoji[row.rank - 1]}</span>
                    <span className="sr-only">{row.rank}</span>
                  </>
                ) : (
                  row.rank
                )}
              </span>
            </Table.Cell>
            <Table.Cell className="font-medium">{row.productName}</Table.Cell>
            <Table.Cell className="text-muted">{row.categoryName ?? "-"}</Table.Cell>
            <Table.Cell className="text-right font-medium">{row.qtySold}</Table.Cell>
            <Table.Cell className="text-right">{formatRupiah(row.totalRevenue)}</Table.Cell>
          </Table.Row>
        ))}
      </ReportTable>
    </ReportPage>
  )
}
