import { useState, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, Printer, RotateCcw, Search, X, CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { type DateRange } from "react-day-picker"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
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
import { Input } from "@/components/ui/input"
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
import { useDebounce } from "@/hooks/use-debounce"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { TransactionDetailDialog } from "./transaction-detail-dialog"
import type { PaginatedTransactions, TransactionListItem } from "../types"

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

const PAYMENT_LABELS: Record<string, string> = {
  cash: id.payment.cash,
  qris: id.payment.qris,
  ewallet: id.payment.ewallet,
  transfer: id.payment.transfer,
}

const STATUS_VARIANTS: Record<string, "default" | "destructive" | "secondary"> = {
  completed: "default",
  refunded: "destructive",
  partial_refund: "secondary",
}

const STATUS_CLASSNAMES: Record<string, string> = {
  completed: "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300",
}

const STATUS_LABELS: Record<string, string> = {
  completed: id.transactions.completed,
  refunded: id.transactions.refunded,
  partial_refund: id.transactions.partialRefund,
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function TransactionsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)
  const [paymentMethod, setPaymentMethod] = useState("")
  const [status, setStatus] = useState("")
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  })
  const [detailTxn, setDetailTxn] = useState<TransactionListItem | null>(null)

  const queryArgs = useMemo(() => ({
    input: {
      page,
      per_page: 50,
      search: debouncedSearch || undefined,
      payment_method: paymentMethod || undefined,
      status: status || undefined,
      date_from: dateRange?.from ? toDateStr(dateRange.from) : undefined,
      date_to: dateRange?.to ? toDateStr(dateRange.to) : undefined,
    },
  }), [page, debouncedSearch, paymentMethod, status, dateRange])

  const { data, isLoading, error, refetch } = useTauriQuery<PaginatedTransactions>(
    "list_transactions",
    queryArgs
  )

  const handlePrint = useCallback(async (transactionId: number) => {
    try {
      await invoke("print_receipt", { transactionId })
      toast.success("Struk dicetak")
    } catch (e) {
      toast.error(`Gagal cetak: ${e}`)
    }
  }, [])

  const resetFilters = useCallback(() => {
    setSearch("")
    setPaymentMethod("")
    setStatus("")
    setDateRange({ from: new Date(), to: new Date() })
    setPage(1)
  }, [])

  const today = toDateStr(new Date())
  const hasFilters = search || paymentMethod || status ||
    (dateRange?.from && toDateStr(dateRange.from) !== today) ||
    (dateRange?.to && toDateStr(dateRange.to) !== today)

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">{id.transactions.title}</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={id.transactions.searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>

        <Select value={paymentMethod} onValueChange={(v) => { setPaymentMethod(v === "all" ? "" : v); setPage(1) }}>
          <SelectTrigger className="w-full max-w-48">
            <SelectValue placeholder={id.transactions.allMethods} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">{id.transactions.allMethods}</SelectItem>
            <SelectItem value="cash">{id.payment.cash}</SelectItem>
            <SelectItem value="qris">{id.payment.qris}</SelectItem>
            <SelectItem value="ewallet">{id.payment.ewallet}</SelectItem>
            <SelectItem value="transfer">{id.payment.transfer}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1) }}>
          <SelectTrigger className="w-full max-w-48">
            <SelectValue placeholder={id.transactions.allStatus} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">{id.transactions.allStatus}</SelectItem>
            <SelectItem value="completed">{id.transactions.completed}</SelectItem>
            <SelectItem value="refunded">{id.transactions.refunded}</SelectItem>
            <SelectItem value="partial_refund">{id.transactions.partialRefund}</SelectItem>
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
              <TableHead>{id.transactions.receiptNumber}</TableHead>
              <TableHead>{id.transactions.cashier}</TableHead>
              <TableHead>{id.transactions.date}</TableHead>
              <TableHead className="text-center">{id.transactions.items}</TableHead>
              <TableHead>{id.transactions.paymentMethod}</TableHead>
              <TableHead>{id.transactions.status}</TableHead>
              <TableHead className="text-right">{id.transactions.totalAmount}</TableHead>
              <TableHead className="text-right w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-destructive">
                  Error: {error.message}
                </TableCell>
              </TableRow>
            ) : !data?.data?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  {id.transactions.noTransactions}
                </TableCell>
              </TableRow>
            ) : (
              data.data.map((txn) => (
                <TableRow key={txn.id} className="cursor-pointer" onClick={() => setDetailTxn(txn)}>
                  <TableCell className="font-mono text-sm">{txn.receipt_number}</TableCell>
                  <TableCell>{txn.cashier_name}</TableCell>
                  <TableCell className="text-sm">{formatDate(txn.created_at)}</TableCell>
                  <TableCell className="text-center">{txn.item_count}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {PAYMENT_LABELS[txn.payment_method] || txn.payment_method}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANTS[txn.status] || "secondary"}
                      className={STATUS_CLASSNAMES[txn.status]}
                    >
                      {STATUS_LABELS[txn.status] || txn.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRupiah(txn.total_amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); setDetailTxn(txn) }}
                        title={id.transactions.detail}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {txn.status !== "refunded" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); navigate(`/refund/${txn.id}`) }}
                          title={id.refund.title}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); handlePrint(txn.id) }}
                        title={id.transactions.printReceipt}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    </div>
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

      <TransactionDetailDialog
        transaction={detailTxn}
        onClose={() => setDetailTxn(null)}
        onRefresh={refetch}
      />
    </div>
  )
}
