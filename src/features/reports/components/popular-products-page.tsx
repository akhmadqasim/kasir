import { useState } from "react"
import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { usePopularProducts } from "../hooks/use-reports"
import { formatRupiah, toLocalDateString } from "@/lib/format"

const rankEmoji = ["🥇", "🥈", "🥉"]

export function PopularProductsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)
  const [limit, setLimit] = useState(20)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading } = usePopularProducts(startDate, endDate, limit)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Produk Populer</h1>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">Top 10</SelectItem>
            <SelectItem value="20">Top 20</SelectItem>
            <SelectItem value="50">Top 50</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Qty Terjual</TableHead>
              <TableHead className="text-right">Total Pendapatan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell>
                    <span className="font-bold">
                      {row.rank <= 3 ? rankEmoji[row.rank - 1] : row.rank}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{row.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{row.categoryName ?? "-"}</TableCell>
                  <TableCell className="text-right font-bold">{row.qtySold}</TableCell>
                  <TableCell className="text-right">{formatRupiah(row.totalRevenue)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
