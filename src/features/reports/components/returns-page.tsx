import { useState } from "react"
import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useReturns } from "../hooks/use-reports"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"

const typeLabels: Record<string, { label: string; variant: "destructive" | "secondary" }> = {
  refund: { label: "Refund", variant: "destructive" },
  exchange: { label: "Tukar", variant: "secondary" },
}

export function ReturnsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading } = useReturns(startDate, endDate)

  const totals = data?.reduce(
    (acc, r) => ({ count: acc.count + 1, amount: acc.amount + r.totalRefundAmount }),
    { count: 0, amount: 0 }
  )

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Retur Produk</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Retur</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{totals.count}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Nilai Retur</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-red-600">{formatRupiah(totals.amount)}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Refund</TableHead>
              <TableHead>No. Struk Asli</TableHead>
              <TableHead>Kasir</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead>Tanggal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.map((row) => {
                const cfg = typeLabels[row.type] ?? { label: row.type, variant: "secondary" as const }
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.refundNumber}</TableCell>
                    <TableCell className="font-mono text-sm">{row.transactionReceipt}</TableCell>
                    <TableCell>{row.cashierName}</TableCell>
                    <TableCell>
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">{formatRupiah(row.totalRefundAmount)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{row.reason ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDayDate(row.createdAt)}
                    </TableCell>
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
