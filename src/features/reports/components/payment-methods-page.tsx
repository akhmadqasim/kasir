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
import { usePaymentMethods } from "../hooks/use-reports"
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

const paymentLabels: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  ewallet: "E-Wallet",
  transfer: "Transfer",
}

const paymentColors: Record<string, string> = {
  cash: "bg-blue-500",
  qris: "bg-purple-500",
  ewallet: "bg-orange-500",
  transfer: "bg-green-500",
}

export function PaymentMethodsPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultRange)

  const startDate = dateRange?.from ? toDateStr(dateRange.from) : ""
  const endDate = dateRange?.to ? toDateStr(dateRange.to) : startDate

  const { data, isLoading } = usePaymentMethods(startDate, endDate)

  const total = data?.reduce((sum, r) => sum + r.totalAmount, 0) ?? 0

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Jenis Pembayaran</h1>

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

      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {data.map((row) => (
            <Card key={row.paymentMethod}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {paymentLabels[row.paymentMethod] ?? row.paymentMethod}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatRupiah(row.totalAmount)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{row.transactionCount} transaksi</span>
                  <span className="text-sm font-medium">({row.percentage.toFixed(1)}%)</span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${paymentColors[row.paymentMethod] ?? "bg-gray-500"}`}
                    style={{ width: `${row.percentage}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metode Pembayaran</TableHead>
              <TableHead className="text-right">Jumlah Transaksi</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Persentase</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              <>
                {data.map((row) => (
                  <TableRow key={row.paymentMethod}>
                    <TableCell className="font-medium">{paymentLabels[row.paymentMethod] ?? row.paymentMethod}</TableCell>
                    <TableCell className="text-right">{row.transactionCount}</TableCell>
                    <TableCell className="text-right">{formatRupiah(row.totalAmount)}</TableCell>
                    <TableCell className="text-right">{row.percentage.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{data.reduce((s, r) => s + r.transactionCount, 0)}</TableCell>
                  <TableCell className="text-right">{formatRupiah(total)}</TableCell>
                  <TableCell className="text-right">100%</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
