import { useState } from "react"
import { DateRangePicker } from "@/components/date-range-picker"
import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"
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
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import { useCashFlows } from "../hooks/use-reports"

export function CashFlowsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate
  const { data, isLoading } = useCashFlows(startDate, endDate)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Uang Masuk / Keluar</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Uang Masuk
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{formatRupiah(data.totalIn)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Uang Keluar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{formatRupiah(data.totalOut)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Saldo Bersih
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${data.netTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatRupiah(data.netTotal)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Kasir</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead className="text-right">Nominal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDayDate(row.createdAt)}
                  </TableCell>
                  <TableCell>{row.cashierName}</TableCell>
                  <TableCell>
                    <Badge variant={row.flowType === "in" ? "secondary" : "destructive"}>
                      <span className="flex items-center gap-1.5">
                        {row.flowType === "in" ? (
                          <ArrowDownCircle className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                        )}
                        {row.flowType === "in" ? "Uang Masuk" : "Uang Keluar"}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[320px] whitespace-normal break-words text-sm text-muted-foreground">
                    {row.description}
                  </TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${row.flowType === "in" ? "text-green-600" : "text-red-600"}`}>
                    {row.flowType === "in" ? "+" : "-"}
                    {formatRupiah(row.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
