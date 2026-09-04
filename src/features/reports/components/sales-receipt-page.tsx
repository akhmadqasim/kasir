import { useState } from "react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { type DateRange } from "react-day-picker"
import { CalendarIcon, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useSalesReceipt } from "../hooks/use-reports"
import { formatDayDate, formatRupiah, toLocalDateString } from "@/lib/format"
import { useDebounce } from "@/hooks/use-debounce"


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

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  completed: { label: "Selesai", variant: "default" },
  pending_ppob: { label: "Menunggu PPOB", variant: "outline" },
  ppob_failed: { label: "PPOB Gagal", variant: "destructive" },
  refunded: { label: "Diretur", variant: "destructive" },
  partial_refund: { label: "Retur Sebagian", variant: "secondary" },
}

export function SalesReceiptPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultRange)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  const { data, isLoading } = useSalesReceipt(startDate, endDate, debouncedSearch)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Penjualan per Struk</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari no. struk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
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

      {data && data.items.length < data.totalCount && (
        <p className="text-sm text-muted-foreground">
          Menampilkan {data.items.length} dari {data.totalCount} struk. Persempit rentang tanggal atau pencarian untuk melihat sisanya.
        </p>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Struk</TableHead>
              <TableHead>Kasir</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-right">Item</TableHead>
              <TableHead>Metode Bayar</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Memuat data...</TableCell>
              </TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Tidak ada data</TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => {
                const st = statusLabels[row.status] ?? { label: row.status, variant: "outline" as const }
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.receiptNumber}</TableCell>
                    <TableCell>{row.cashierName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDayDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">{row.itemCount}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{paymentLabels[row.paymentMethod] ?? row.paymentMethod}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatRupiah(row.totalAmount)}</TableCell>
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
