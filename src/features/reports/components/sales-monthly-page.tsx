import { useState } from "react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useSalesMonthly } from "../hooks/use-reports"
import { formatRupiah } from "@/lib/format"

export function SalesMonthlyPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { data, isLoading } = useSalesMonthly(year)

  const totals = data?.reduce(
    (acc, row) => ({
      transactions: acc.transactions + row.transactionCount,
      revenue: acc.revenue + row.totalRevenue,
      cost: acc.cost + row.totalCost,
      profit: acc.profit + row.grossProfit,
    }),
    { transactions: 0, revenue: 0, cost: 0, profit: 0 }
  )

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Penjualan per Bulan</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Transaksi</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{totals.transactions}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Pendapatan</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatRupiah(totals.revenue)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Modal</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatRupiah(totals.cost)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Laba Kotor</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-green-600">{formatRupiah(totals.profit)}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bulan</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
              <TableHead className="text-right">Modal</TableHead>
              <TableHead className="text-right">Laba Kotor</TableHead>
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
              data.map((row) => {
                const monthDate = new Date(`${row.month}-01`)
                return (
                  <TableRow key={row.month}>
                    <TableCell className="font-medium">{format(monthDate, "MMMM yyyy", { locale: idLocale })}</TableCell>
                    <TableCell className="text-right">{row.transactionCount}</TableCell>
                    <TableCell className="text-right">{formatRupiah(row.totalRevenue)}</TableCell>
                    <TableCell className="text-right">{formatRupiah(row.totalCost)}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">{formatRupiah(row.grossProfit)}</TableCell>
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
