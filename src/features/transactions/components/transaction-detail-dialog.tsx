import { Loader2, Pencil, Printer, RefreshCcw, RotateCcw, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { useAuthStore } from "@/features/auth"
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
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const [isRetrying, setIsRetrying] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteReason, setDeleteReason] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [showEditPayment, setShowEditPayment] = useState(false)
  const [newPaymentMethod, setNewPaymentMethod] = useState("")
  const [editPaymentReason, setEditPaymentReason] = useState("")
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false)

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

  const handleDelete = async () => {
    if (!transaction || !user) return
    if (!deleteReason.trim()) {
      toast.error(id.transactions.reasonRequired)
      return
    }
    setIsDeleting(true)
    try {
      await invoke("delete_transaction", {
        input: {
          transaction_id: transaction.id,
          user_id: user.id,
          reason: deleteReason.trim(),
        },
      })
      toast.success(id.transactions.deleteSuccess)
      setShowDeleteConfirm(false)
      setDeleteReason("")
      onClose()
      queryClient.invalidateQueries({ queryKey: ["list_transactions"] })
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleUpdatePaymentMethod = async () => {
    if (!transaction || !user) return
    if (!editPaymentReason.trim()) {
      toast.error(id.transactions.reasonRequired)
      return
    }
    setIsUpdatingPayment(true)
    try {
      await invoke("update_payment_method", {
        input: {
          transaction_id: transaction.id,
          user_id: user.id,
          payment_method: newPaymentMethod,
          reason: editPaymentReason.trim(),
        },
      })
      toast.success(id.transactions.editPaymentSuccess)
      setShowEditPayment(false)
      setNewPaymentMethod("")
      setEditPaymentReason("")
      queryClient.invalidateQueries({ queryKey: ["get_transaction_detail"] })
      queryClient.invalidateQueries({ queryKey: ["list_transactions"] })
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      setIsUpdatingPayment(false)
    }
  }

  const isDeleted = detail?.transaction.status === "deleted"

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
              {detail.transaction.deleted_reason && (
                <>
                  <Separator className="my-2" />
                  <div className="rounded-md bg-red-50 p-2 dark:bg-red-950">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Alasan Penghapusan</p>
                    <p className="text-sm text-red-600 dark:text-red-300">{detail.transaction.deleted_reason}</p>
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

            <div className="flex justify-between gap-2">
              <div className="flex gap-2">
                {isAdmin && !isDeleted && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {id.common.delete}
                  </Button>
                )}
                {isAdmin && !isDeleted && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setNewPaymentMethod(detail.transaction.payment_method)
                      setShowEditPayment(true)
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {id.transactions.editPaymentMethod}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
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
                {!detail.has_ppob && detail.transaction.status !== "refunded" && !isDeleted && (
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
                <Button size="sm" onClick={handlePrint} disabled={isDeleted}>
                  <Printer className="mr-2 h-4 w-4" />
                  {id.transactions.printReceipt}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{id.transactions.deleteTransaction}</AlertDialogTitle>
            <AlertDialogDescription>
              {id.transactions.deleteConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={id.transactions.deleteReasonPlaceholder}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            className="min-h-[80px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteReason(""); setShowDeleteConfirm(false) }}>
              {id.common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting || !deleteReason.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {id.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Payment Method Dialog */}
      <Dialog open={showEditPayment} onOpenChange={setShowEditPayment}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{id.transactions.editPaymentMethod}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={newPaymentMethod} onValueChange={setNewPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{id.payment.cash}</SelectItem>
                <SelectItem value="qris">{id.payment.qris}</SelectItem>
                <SelectItem value="ewallet">{id.payment.ewallet}</SelectItem>
                <SelectItem value="transfer">{id.payment.transfer}</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder={id.transactions.editPaymentReasonPlaceholder}
              value={editPaymentReason}
              onChange={(e) => setEditPaymentReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditPaymentReason(""); setShowEditPayment(false) }}>
              {id.common.cancel}
            </Button>
            <Button
              onClick={handleUpdatePaymentMethod}
              disabled={isUpdatingPayment || !editPaymentReason.trim() || !newPaymentMethod}
            >
              {isUpdatingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {id.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
