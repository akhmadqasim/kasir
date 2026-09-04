import { useState } from "react"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { useCurrentStock } from "../hooks/use-reports"
import { formatRupiah } from "@/lib/format"
import { useDebounce } from "@/hooks/use-debounce"

export function CurrentStockPage() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "low">("all")
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading } = useCurrentStock(debouncedSearch, filter)

  const totals = data?.items.reduce(
    (acc, r) => ({
      lowStock: acc.lowStock + (r.stock <= r.minStock && r.minStock > 0 ? 1 : 0),
      value: acc.value + r.stockValue,
    }),
    { lowStock: 0, value: 0 }
  )
  // Backend membatasi jumlah baris. Kartu di bawah dihitung dari baris yang
  // terkirim saja, jadi katakan apa adanya saat daftarnya terpotong.
  const isTruncated = !!data && data.items.length < data.totalCount

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Stok Saat Ini</h1>

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
        <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "low")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Produk</SelectItem>
            <SelectItem value="low">Stok Menipis</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {totals && data && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Produk</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{data.totalCount}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Produk Stok Menipis</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-red-600">{totals.lowStock}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Nilai Stok</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{formatRupiah(totals.value)}</p></CardContent>
            </Card>
          </div>
          {isTruncated && (
            <p className="text-sm text-muted-foreground">
              Menampilkan {data.items.length} dari {data.totalCount} produk. Kartu stok menipis dan nilai stok dihitung dari baris yang tampil saja — persempit pencarian untuk angka yang utuh.
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Stok</TableHead>
              <TableHead className="text-right">Min. Stok</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead className="text-right">Harga Beli</TableHead>
              <TableHead className="text-right">Harga Jual</TableHead>
              <TableHead className="text-right">Nilai Stok</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => {
                const isLow = row.stock <= row.minStock && row.minStock > 0
                return (
                  <TableRow key={row.productId} className={isLow ? "bg-red-50 dark:bg-red-950/20" : ""}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{row.barcode ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{row.categoryName ?? "-"}</TableCell>
                    <TableCell className="text-right">
                      <span className={isLow ? "font-bold text-red-600" : "font-medium"}>{row.stock}</span>
                      {isLow && <Badge variant="destructive" className="ml-2 text-[10px]">Low</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.minStock}</TableCell>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell className="text-right">{formatRupiah(row.buyPrice)}</TableCell>
                    <TableCell className="text-right">{formatRupiah(row.sellPrice)}</TableCell>
                    <TableCell className="text-right font-medium">{formatRupiah(row.stockValue)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
