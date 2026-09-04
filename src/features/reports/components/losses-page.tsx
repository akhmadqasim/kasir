import { useState } from "react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { type DateRange } from "react-day-picker"
import { CalendarIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
import { useLosses } from "../hooks/use-reports"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"


function getDefaultRange(): DateRange {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

const reasonLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  damaged: { label: "Rusak", variant: "destructive" },
  expired: { label: "Kadaluarsa", variant: "secondary" },
  lost: { label: "Hilang", variant: "outline" },
  other: { label: "Lainnya", variant: "default" },
}

const statusLabels: Record<string, { label: string; variant: "default" | "outline" | "secondary" }> = {
  approved: { label: "Disetujui", variant: "default" },
  pending: { label: "Menunggu", variant: "outline" },
  rejected: { label: "Ditolak", variant: "secondary" },
}

export function LossesPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading } = useLosses(startDate, endDate)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Laporan Kerugian</h1>

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
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Write-off</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{data.totalWriteoffs}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Qty</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{data.totalQuantity}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Kerugian</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-red-600">{formatRupiah(data.totalLossValue)}</p></CardContent>
            </Card>
          </div>

          {data.byReason.length > 0 && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {data.byReason.map((r) => {
                const cfg = reasonLabels[r.reason] ?? { label: r.reason, variant: "default" as const }
                return (
                  <Card key={r.reason}>
                    <CardContent className="pt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        <span className="text-sm text-muted-foreground">{r.count}x</span>
                      </div>
                      <p className="text-lg font-bold text-red-600">{formatRupiah(r.totalValue)}</p>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. WO</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead>Kasir</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead className="text-right">Nilai Kerugian</TableHead>
              <TableHead>Catatan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tanggal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.items?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => {
                const reasonCfg = reasonLabels[row.reason] ?? { label: row.reason, variant: "default" as const }
                const statusCfg = statusLabels[row.status] ?? { label: row.status, variant: "outline" as const }
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.writeoffNumber}</TableCell>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell>{row.cashierName}</TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell>
                      <Badge variant={reasonCfg.variant}>{reasonCfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">{formatRupiah(row.lossValue)}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-sm text-muted-foreground">{row.notes ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                    </TableCell>
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
