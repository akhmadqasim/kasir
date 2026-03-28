import { useState } from "react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { type DateRange } from "react-day-picker"
import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useSalesPeriod } from "../hooks/use-reports"
import { formatRupiah } from "@/lib/format"

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function getDefaultRange(): DateRange {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

export function SalesPeriodPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultRange)

  const startDate = dateRange?.from ? toDateStr(dateRange.from) : ""
  const endDate = dateRange?.to ? toDateStr(dateRange.to) : startDate

  const { data, isLoading } = useSalesPeriod(startDate, endDate)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Penjualan per Periode</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                data-empty={!dateRange?.from}
                className="justify-start px-2.5 font-normal data-[empty=true]:text-muted-foreground"
              >
                <CalendarIcon />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "dd MMM yyyy", { locale: idLocale })}
                      {" - "}
                      {format(dateRange.to, "dd MMM yyyy", { locale: idLocale })}
                    </>
                  ) : (
                    format(dateRange.from, "dd MMM yyyy", { locale: idLocale })
                  )
                ) : (
                  <span>Pilih tanggal</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                locale={idLocale}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Transaksi</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{data.totalTransactions}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Pendapatan</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatRupiah(data.totalRevenue)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Modal</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatRupiah(data.totalCost)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Laba Kotor</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-green-600">{formatRupiah(data.grossProfit)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Rata-rata / Transaksi</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatRupiah(data.avgPerTransaction)}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
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
            ) : !data?.dailyBreakdown?.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.dailyBreakdown.map((row) => (
                <TableRow key={row.date}>
                  <TableCell className="font-medium">{new Date(row.date).toLocaleDateString("id-ID", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</TableCell>
                  <TableCell className="text-right">{row.transactionCount}</TableCell>
                  <TableCell className="text-right">{formatRupiah(row.totalRevenue)}</TableCell>
                  <TableCell className="text-right">{formatRupiah(row.totalCost)}</TableCell>
                  <TableCell className="text-right font-medium text-green-600">{formatRupiah(row.grossProfit)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
