import { Printer } from "lucide-react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
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
  return dateFormatter.format(new Date(dateStr.replace(" ", "T")))
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

const STATUS_LABELS: Record<string, string> = {
  completed: id.transactions.completed,
  refunded: id.transactions.refunded,
  partial_refund: id.transactions.partialRefund,
}

interface TransactionDetailDialogProps {
  transaction: TransactionListItem | null
  onClose: () => void
}

export function TransactionDetailDialog({ transaction, onClose }: TransactionDetailDialogProps) {
  const { data: detail, isLoading } = useTauriQuery<TransactionDetail>(
    "get_transaction_detail",
    { transactionId: transaction?.id },
    { enabled: !!transaction }
  )

  const handlePrint = async () => {
    if (!transaction) return
    try {
      await invoke("print_receipt", { transactionId: transaction.id })
      toast.success("Struk dicetak")
    } catch (e) {
      toast.error(`Gagal cetak: ${e}`)
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
                <Badge variant={STATUS_VARIANTS[detail.transaction.status] || "secondary"}>
                  {STATUS_LABELS[detail.transaction.status] || detail.transaction.status}
                </Badge>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="mb-2 text-sm font-medium">{id.transactions.itemList}</h4>
              <div className="space-y-1">
                {detail.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <span>{item.product_name}</span>
                      <span className="ml-2 text-muted-foreground">× {item.quantity}</span>
                    </div>
                    <span className="tabular-nums">{formatRupiah(item.subtotal)}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-1 text-sm">
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
                <div className="pt-1">
                  <p className="text-muted-foreground">{id.transactions.notes}</p>
                  <p>{detail.transaction.notes}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
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
