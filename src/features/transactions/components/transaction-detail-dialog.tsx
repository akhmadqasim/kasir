import { Loader2, Printer, RefreshCcw, RotateCcw } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import type { TransactionDetail, TransactionListItem } from "../types"

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  return dateFormatter.format(new Date(dateStr.replace(" ", "T") + "Z"))
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: id.payment.cash,
  qris: id.payment.qris,
  ewallet: id.payment.ewallet,
  transfer: id.payment.transfer,
}

const STATUS_VARIANTS: Record<string, "default" | "destructive" | "secondary"> = {
  completed: "default",
  pending_ppob: "secondary",
  ppob_failed: "destructive",
  refunded: "destructive",
  partial_refund: "secondary",
}

const STATUS_CLASSNAMES: Record<string, string> = {
  completed: "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300",
  pending_ppob: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
}

const STATUS_LABELS: Record<string, string> = {
  completed: id.transactions.completed,
  pending_ppob: id.transactions.pendingPpob,
  ppob_failed: id.transactions.ppobFailed,
  refunded: id.transactions.refunded,
  partial_refund: id.transactions.partialRefund,
}

const PPOB_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu", className: "bg-amber-50 text-amber-700" },
  success: { label: "Berhasil", className: "bg-green-50 text-green-700" },
  failed: { label: "Gagal", className: "bg-red-50 text-red-700" },
}

interface TransactionDetailDialogProps {
  transaction: TransactionListItem | null
  onClose: () => void
}

export function TransactionDetailDialog({ transaction, onClose }: TransactionDetailDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isRetrying, setIsRetrying] = useState(false)

  const { data: detail, isLoading } = useTauriQuery<TransactionDetail>(
    "get_transaction_detail",
    { transactionId: transaction?.id },
    { enabled: !!transaction }
  )

  const ppobItem = detail?.items.find((item) => item.service_type)
  const ppobCanRetry = ppobItem?.ppob_status === "failed" || ppobItem?.ppob_status === "pending"

  const handlePrint = async () => {
    if (!transaction) return
    try {
      await invoke("print_receipt", { transactionId: transaction.id })
      toast.success("Struk dicetak")
    } catch (e) {
      toast.error(`Gagal cetak: ${e}`)
    }
  }

  const handleRetryPpob = async () => {
    if (!ppobItem) return
    setIsRetrying(true)
    try {
      await invoke("retry_ppob_fulfillment", { itemId: ppobItem.id })
      toast.success("PPOB sedang diproses ulang di latar belakang")
      queryClient.invalidateQueries({ queryKey: ["get_transaction_detail"] })
      queryClient.invalidateQueries({ queryKey: ["list_transactions"] })
    } catch (e) {
      toast.error(`Gagal retry: ${e}`)
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{id.transactions.detail}</DialogTitle>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">{id.transactions.receiptNumber}</p>
                <p className="font-mono font-medium">{detail.transaction.receipt_number}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{id.transactions.date}</p>
                <p>{formatDate(detail.transaction.created_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{id.transactions.cashier}</p>
                <p>{detail.cashier_name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{id.transactions.status}</p>
                <Badge
                  variant={STATUS_VARIANTS[detail.transaction.status] || "secondary"}
                  className={STATUS_CLASSNAMES[detail.transaction.status]}
                >
                  {STATUS_LABELS[detail.transaction.status] || detail.transaction.status}
                </Badge>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="mb-2 text-sm font-medium">{id.transactions.itemList}</h4>
              <div className="space-y-1">
                {detail.items.map((item) => {
                  const ppobStatus = item.ppob_status ? PPOB_STATUS_CONFIG[item.ppob_status] : null
                  return (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <div className="min-w-0 flex-1">
                        <span>{item.product_name}</span>
                        <span className="ml-2 text-muted-foreground">× {item.quantity}</span>
                        {ppobStatus && (
                          <Badge variant="outline" className={`ml-2 text-xs ${ppobStatus.className}`}>
                            {item.ppob_status === "pending" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {ppobStatus.label}
                          </Badge>
                        )}
                      </div>
                      <span className="tabular-nums">{formatRupiah(item.subtotal)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <Separator />

            <div className="space-y-1 text-sm">
              {detail.transaction.discount_amount > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatRupiah(detail.transaction.subtotal_amount)}</span>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span>Diskon</span>
                    <span className="tabular-nums">-{formatRupiah(detail.transaction.discount_amount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-semibold">
                <span>{id.transactions.totalAmount}</span>
                <span className="tabular-nums">{formatRupiah(detail.transaction.total_amount)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{id.transactions.paymentMethod}</span>
                <span>{PAYMENT_LABELS[detail.transaction.payment_method] || detail.transaction.payment_method}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{id.transactions.paymentAmount}</span>
                <span className="tabular-nums">{formatRupiah(detail.transaction.payment_amount)}</span>
              </div>
              {detail.transaction.payment_method === "cash" && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{id.transactions.changeAmount}</span>
                  <span className="tabular-nums">{formatRupiah(detail.transaction.change_amount ?? 0)}</span>
                </div>
              )}
              {detail.transaction.notes && (
                <>
                  <Separator className="my-2" />
                  <div>
                    <p className="text-sm font-medium">{id.transactions.notes}</p>
                    <p>{detail.transaction.notes}</p>
                  </div>
                </>
              )}
              {ppobItem && (
                <div className="pt-1 space-y-1">
                  <p className="text-muted-foreground">Status PPOB</p>
                  {ppobItem.ppob_message && <p>{ppobItem.ppob_message}</p>}
                  {ppobItem.ppob_serial_number && (
                    <p className="font-mono text-xs text-muted-foreground">
                      SN: {ppobItem.ppob_serial_number}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              {ppobCanRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetryPpob}
                  disabled={isRetrying}
                >
                  {isRetrying ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-2 h-4 w-4" />
                  )}
                  Retry PPOB
                </Button>
              )}
              {!detail.has_ppob && detail.transaction.status !== "refunded" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onClose()
                    navigate(`/refund/${detail.transaction.id}`)
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {id.refund.title}
                </Button>
              )}
              <Button size="sm" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                {id.transactions.printReceipt}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
