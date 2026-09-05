import { useState, useMemo } from "react"
import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useProductSales } from "../hooks/use-reports"
import { formatRupiah, toLocalDateString } from "@/lib/format"
import { useDebounce } from "@/hooks/use-debounce"

export function ProductSalesPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading } = useProductSales(startDate, endDate)

  const filtered = useMemo(() => {
    if (!data) return []
    if (!debouncedSearch) return data
    const q = debouncedSearch.toLowerCase()
    return data.filter((r) => r.productName.toLowerCase().includes(q))
  }, [data, debouncedSearch])

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Penjualan Produk</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari produk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Qty Terjual</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
              <TableHead className="text-right">Modal</TableHead>
              <TableHead className="text-right">Laba</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !filtered.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell className="font-medium">{row.productName}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{row.barcode ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.categoryName ?? "-"}</TableCell>
                  <TableCell className="text-right">{row.qtySold}</TableCell>
                  <TableCell className="text-right">{formatRupiah(row.totalRevenue)}</TableCell>
                  <TableCell className="text-right">{formatRupiah(row.totalCost)}</TableCell>
                  <TableCell className="text-right font-medium text-green-600">{formatRupiah(row.profit)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
