import { useState, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, Printer, RotateCcw, Search, X } from "lucide-react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { keepPreviousData } from "@tanstack/react-query"
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
import { DateRangePicker } from "@/components/date-range-picker"
import { getTodayRange, type DateRange } from "@/lib/date-range"
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
import { formatDateTime, formatRupiah, toLocalDateString } from "@/lib/format"
import { id } from "@/i18n/id"
import { TransactionDetailDialog } from "./transaction-detail-dialog"
import type { PaginatedTransactions, TransactionListItem } from "../types"

const PAYMENT_LABELS: Record<string, string> = {
  cash: id.payment.cash,
  qris: id.payment.qris,
  debit: id.payment.debit,
  ewallet: id.payment.ewallet,
  transfer: id.payment.transfer,
  mixed: id.payment.mixed,
}

const STATUS_VARIANTS: Record<string, "default" | "destructive" | "secondary"> = {
  completed: "default",
  pending_ppob: "secondary",
  ppob_failed: "destructive",
  refunded: "destructive",
  partial_refund: "secondary",
  deleted: "destructive",
}

const STATUS_CLASSNAMES: Record<string, string> = {
  completed: "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300",
  pending_ppob: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  deleted: "bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300",
}

const STATUS_LABELS: Record<string, string> = {
  completed: id.transactions.completed,
  pending_ppob: id.transactions.pendingPpob,
  ppob_failed: id.transactions.ppobFailed,
  refunded: id.transactions.refunded,
  partial_refund: id.transactions.partialRefund,
  deleted: id.transactions.deleted,
}

function getTransactionDescription(txn: TransactionListItem): string {
  if (txn.deleted_reason?.trim()) {
    return `Alasan hapus: ${txn.deleted_reason.trim()}`
  }

  if (txn.notes?.trim()) {
    return txn.notes.trim()
  }

  if (txn.ppob_message?.trim()) {
    return txn.ppob_message.trim()
  }

  return "—"
}


export function TransactionsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 300)
  const [paymentMethod, setPaymentMethod] = useState("")
  const [status, setStatus] = useState("")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getTodayRange)
  const [detailTxn, setDetailTxn] = useState<TransactionListItem | null>(null)

  const queryArgs = useMemo(() => ({
    input: {
      page,
      per_page: 50,
      search: debouncedSearch || undefined,
      payment_method: paymentMethod || undefined,
      status: status || undefined,
      date_from: dateRange?.from ? toLocalDateString(dateRange.from) : undefined,
      date_to: dateRange?.to ? toLocalDateString(dateRange.to) : undefined,
    },
  }), [page, debouncedSearch, paymentMethod, status, dateRange])

  const { data, isLoading, error } = useTauriQuery<PaginatedTransactions>(
    "list_transactions",
    queryArgs,
    {
      placeholderData: keepPreviousData,
    }
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
    setDateRange(getTodayRange())
    setPage(1)
  }, [])

  const today = toLocalDateString(new Date())
  const hasFilters = search || paymentMethod || status ||
    (dateRange?.from && toLocalDateString(dateRange.from) !== today) ||
    (dateRange?.to && toLocalDateString(dateRange.to) !== today)

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
          <SelectContent>
            <SelectItem value="all">{id.transactions.allMethods}</SelectItem>
            <SelectItem value="cash">{id.payment.cash}</SelectItem>
            <SelectItem value="qris">{id.payment.qris}</SelectItem>
            <SelectItem value="debit">{id.payment.debit}</SelectItem>
            <SelectItem value="ewallet">{id.payment.ewallet}</SelectItem>
            <SelectItem value="transfer">{id.payment.transfer}</SelectItem>
            <SelectItem value="mixed">{id.payment.mixed}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1) }}>
          <SelectTrigger className="w-full max-w-48">
            <SelectValue placeholder={id.transactions.allStatus} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{id.transactions.allStatus}</SelectItem>
            <SelectItem value="completed">{id.transactions.completed}</SelectItem>
            <SelectItem value="pending_ppob">{id.transactions.pendingPpob}</SelectItem>
            <SelectItem value="ppob_failed">{id.transactions.ppobFailed}</SelectItem>
            <SelectItem value="refunded">{id.transactions.refunded}</SelectItem>
            <SelectItem value="partial_refund">{id.transactions.partialRefund}</SelectItem>
            <SelectItem value="deleted">{id.transactions.deleted}</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="mr-1 h-4 w-4" />
            {id.transactions.resetFilter}
          </Button>
        )}

        <div className="ml-auto">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => { setDateRange(range); setPage(1) }}
            align="start"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-md border">
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow>
              <TableHead>{id.transactions.receiptNumber}</TableHead>
              <TableHead>{id.transactions.cashier}</TableHead>
              <TableHead>{id.transactions.date}</TableHead>
              <TableHead className="text-center">{id.transactions.items}</TableHead>
              <TableHead>{id.transactions.paymentMethod}</TableHead>
              <TableHead>{id.transactions.description}</TableHead>
              <TableHead>{id.transactions.status}</TableHead>
              <TableHead className="text-right">{id.transactions.totalAmount}</TableHead>
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
            ) : !data?.data?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  {id.transactions.noTransactions}
                </TableCell>
              </TableRow>
            ) : (
              data.data.map((txn) => (
                <TableRow
                  key={txn.id}
                  className={`cursor-pointer ${txn.status === "deleted" ? "opacity-50" : ""}`}
                  onClick={() => setDetailTxn(txn)}
                >
                  <TableCell className="font-mono text-sm">
                    <div className="space-y-1">
                      <p>{txn.receipt_number}</p>
                      {txn.ppob_message && (
                        <p className="max-w-48 truncate text-xs text-muted-foreground">
                          {txn.ppob_message}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{txn.cashier_name}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(txn.created_at)}</TableCell>
                  <TableCell className="text-center">{txn.item_count}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {PAYMENT_LABELS[txn.payment_method] || txn.payment_method}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <p className="break-words text-sm text-muted-foreground">
                      {getTransactionDescription(txn)}
                    </p>
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
                      {!txn.has_ppob && txn.status !== "refunded" && txn.status !== "deleted" && (
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
                        disabled={txn.has_ppob && txn.status !== "completed" && txn.status !== "deleted"}
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
      />
    </div>
  )
}
