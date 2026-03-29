import { useState, useCallback, useMemo } from "react"
import { Eye, X, CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { type DateRange } from "react-day-picker"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { RefundDetailDialog } from "./refund-detail-dialog"
import type { ListRefundsResult } from "../types"

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  const date = new Date(dateStr.replace(" ", "T") + "Z")
  return dateFormatter.format(date)
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function getDifferenceColor(amount: number): string {
  if (amount > 0) return "text-green-600 dark:text-green-400"
  if (amount < 0) return "text-red-600 dark:text-red-400"
  return "text-muted-foreground"
}

export function RefundsPage() {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState("")
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  })
  const [detailRefundId, setDetailRefundId] = useState<number | null>(null)

  const queryArgs = useMemo(() => ({
    input: {
      page,
      per_page: 50,
      refund_type: typeFilter || undefined,
      date_from: dateRange?.from ? toDateStr(dateRange.from) : undefined,
      date_to: dateRange?.to ? toDateStr(dateRange.to) : undefined,
    },
  }), [page, typeFilter, dateRange])

  const { data, isLoading, error } = useTauriQuery<ListRefundsResult>(
    "list_refunds",
    queryArgs,
    { enabled: true }
  )

  const resetFilters = useCallback(() => {
    setTypeFilter("")
    setDateRange({ from: new Date(), to: new Date() })
    setPage(1)
  }, [])

  const today = toDateStr(new Date())
  const hasFilters = typeFilter ||
    (dateRange?.from && toDateStr(dateRange.from) !== today) ||
    (dateRange?.to && toDateStr(dateRange.to) !== today)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">{id.refund.history}</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === "all" ? "" : v); setPage(1) }}>
          <SelectTrigger className="w-full max-w-48">
            <SelectValue placeholder={id.refund.allTypes} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{id.refund.allTypes}</SelectItem>
            <SelectItem value="refund">{id.refund.typeRefund}</SelectItem>
            <SelectItem value="exchange">{id.refund.typeExchange}</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="mr-1 h-4 w-4" />
            {id.transactions.resetFilter}
          </Button>
        )}

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
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={(range) => { setDateRange(range); setPage(1) }}
                numberOfMonths={2}
                locale={idLocale}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{id.refund.refundNumber}</TableHead>
              <TableHead>{id.refund.transactionReceipt}</TableHead>
              <TableHead>{id.refund.type}</TableHead>
              <TableHead className="text-right">{id.refund.totalRefund}</TableHead>
              <TableHead className="text-right">{id.refund.totalExchange}</TableHead>
              <TableHead className="text-right">{id.refund.difference}</TableHead>
              <TableHead>{id.refund.cashier}</TableHead>
              <TableHead>{id.transactions.date}</TableHead>
              <TableHead className="text-right w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-destructive">
                  Error: {error.message}
                </TableCell>
              </TableRow>
            ) : !data?.items?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  {id.refund.noRefunds}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer" onClick={() => setDetailRefundId(item.id)}>
                  <TableCell className="font-mono text-sm">{item.refund_number}</TableCell>
                  <TableCell className="font-mono text-sm">{item.transaction_receipt}</TableCell>
                  <TableCell>
                    {item.refund_type === "exchange" ? (
                      <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        {id.refund.typeExchange}
                      </Badge>
                    ) : (
                      <Badge variant="default">
                        {id.refund.typeRefund}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(item.total_refund_amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.refund_type === "exchange"
                      ? formatRupiah(item.total_exchange_amount)
                      : "—"}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${getDifferenceColor(item.difference_amount)}`}>
                    {item.refund_type === "exchange"
                      ? formatRupiah(item.difference_amount)
                      : "—"}
                  </TableCell>
                  <TableCell>{item.cashier_name}</TableCell>
                  <TableCell className="text-sm">{formatDate(item.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); setDetailRefundId(item.id) }}
                      title={id.refund.detail}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">
            {id.transactions.page} {data.page} {id.transactions.of} {data.total_pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {id.transactions.prev}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.total_pages}
            onClick={() => setPage(page + 1)}
          >
            {id.transactions.next}
          </Button>
        </div>
      )}

      <RefundDetailDialog
        refundId={detailRefundId}
        onClose={() => setDetailRefundId(null)}
      />
    </div>
  )
}
