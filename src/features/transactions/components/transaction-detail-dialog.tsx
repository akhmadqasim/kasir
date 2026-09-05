import { Loader2, Pencil, Printer, RefreshCcw, RotateCcw, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "@/lib/toast"
import { invoke } from "@tauri-apps/api/core"
import { useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { formatDateTime, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import type { TransactionDetail, TransactionListItem } from "../types"


const PAYMENT_LABELS: Record<string, string> = {
  cash: id.payment.cash,
  qris: id.payment.qris,
  debit: id.payment.debit,
  ewallet: id.payment.ewallet,
  transfer: id.payment.transfer,
  mixed: id.payment.mixed,
}

function formatPaymentSplitLabel(paymentMethod: string, bankName?: string | null): string {
  const label = PAYMENT_LABELS[paymentMethod] || paymentMethod
  return bankName?.trim() ? `${label} (${bankName.trim()})` : label
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

function SummaryRow({
  label,
  value,
  mono = false,
  rowClassName,
  valueClassName,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  rowClassName?: string
  valueClassName?: string
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 text-sm", rowClassName)}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right font-medium", mono && "font-mono", valueClassName)}>{value}</span>
    </div>
  )
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
  const isDeleted = detail?.transaction.status === "deleted"
  const hasRefundAction = !!detail && !detail.has_ppob && detail.transaction.status !== "refunded" && !isDeleted
  const originalTotalAmount = detail
    ? Math.max(detail.transaction.subtotal_amount - detail.transaction.discount_amount, 0)
    : 0

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

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-0 overflow-hidden p-0 sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle>{id.transactions.detail}</DialogTitle>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="space-y-3 px-4 py-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[min(78svh,680px)]">
              <div className="space-y-4 px-4 py-4">
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold">Ringkasan Transaksi</h3>
                  <div className="space-y-1.5">
                    <SummaryRow
                      label={id.transactions.receiptNumber}
                      value={detail.transaction.receipt_number}
                      mono
                    />
                    <SummaryRow
                      label={id.transactions.date}
                      value={formatDateTime(detail.transaction.created_at)}
                    />
                    <SummaryRow
                      label={id.transactions.cashier}
                      value={detail.cashier_name}
                    />
                    <SummaryRow
                      label={id.transactions.status}
                      value={(
                        <Badge
                          variant={STATUS_VARIANTS[detail.transaction.status] || "secondary"}
                          className={STATUS_CLASSNAMES[detail.transaction.status]}
                        >
                          {STATUS_LABELS[detail.transaction.status] || detail.transaction.status}
                        </Badge>
                      )}
                      rowClassName="items-center"
                    />
                  </div>
                </section>

                <Separator />

                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold">{id.transactions.itemList}</h3>
                  <div className="rounded-lg border">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Item</span>
                      <span className="text-right">Subtotal</span>
                    </div>
                    <div className="divide-y">
                      {detail.items.map((item) => {
                        const ppobStatus = item.ppob_status ? PPOB_STATUS_CONFIG[item.ppob_status] : null
                        return (
                          <div
                            key={item.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-2.5 text-sm"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium break-words">{item.product_name}</span>
                                <span className="text-muted-foreground">× {item.quantity}</span>
                                {ppobStatus && (
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${ppobStatus.className}`}
                                  >
                                    {item.ppob_status === "pending" && (
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                    )}
                                    {ppobStatus.label}
                                  </Badge>
                                )}
                              </div>
                              {item.item_discount > 0 && (
                                <p className="text-xs text-destructive">
                                  Diskon item: -{formatRupiah(item.item_discount)}
                                </p>
                              )}
                            </div>
                            <div className="text-right font-medium tabular-nums">
                              {formatRupiah(item.subtotal)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>

                <Separator />

                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold">Ringkasan Pembayaran</h3>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="space-y-1.5">
                      {detail.transaction.discount_amount > 0 && (
                        <>
                          <SummaryRow
                            label="Subtotal"
                            value={formatRupiah(detail.transaction.subtotal_amount)}
                            valueClassName="tabular-nums"
                          />
                          <SummaryRow
                            label="Diskon"
                            value={`-${formatRupiah(detail.transaction.discount_amount)}`}
                            valueClassName="tabular-nums text-destructive"
                          />
                        </>
                      )}
                      <SummaryRow
                        label={id.transactions.totalAmount}
                        value={formatRupiah(detail.transaction.total_amount)}
                        valueClassName="tabular-nums text-base font-semibold text-foreground"
                      />
                      {isDeleted && (
                        <SummaryRow
                          label="Total sebelum hapus"
                          value={formatRupiah(originalTotalAmount)}
                          valueClassName="tabular-nums"
                        />
                      )}
                      <SummaryRow
                        label={id.transactions.paymentMethod}
                        value={formatPaymentSplitLabel(
                          detail.transaction.payment_method,
                          detail.payment_breakdown[0]?.bank_name
                        )}
                        valueClassName="text-foreground"
                      />
                      {detail.payment_breakdown.length > 1 && (
                        <div className="rounded-md border bg-background px-3 py-2">
                          <div className="space-y-1.5">
                            {detail.payment_breakdown.map((split) => (
                              <SummaryRow
                                key={`${split.payment_method}-${split.bank_name ?? "default"}`}
                                label={formatPaymentSplitLabel(split.payment_method, split.bank_name)}
                                value={formatRupiah(split.amount)}
                                valueClassName="tabular-nums"
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      <SummaryRow
                        label={id.transactions.paymentAmount}
                        value={formatRupiah(detail.transaction.payment_amount)}
                        valueClassName="tabular-nums"
                      />
                      {(detail.transaction.change_amount ?? 0) > 0 && (
                        <SummaryRow
                          label={id.transactions.changeAmount}
                          value={formatRupiah(detail.transaction.change_amount ?? 0)}
                          valueClassName="tabular-nums"
                        />
                      )}
                    </div>
                  </div>
                </section>

                {(detail.transaction.notes || detail.transaction.deleted_reason || ppobItem) && (
                  <>
                    <Separator />
                    <section className="space-y-2.5">
                      <h3 className="text-sm font-semibold">Info Tambahan</h3>
                      <div className="space-y-2.5">
                        {detail.transaction.notes && (
                          <div className="rounded-lg border p-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {id.transactions.notes}
                            </p>
                            <p className="mt-2 text-sm leading-relaxed">{detail.transaction.notes}</p>
                          </div>
                        )}
                        {detail.transaction.deleted_reason && (
                          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-destructive">
                              Alasan Penghapusan
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-destructive">
                              {detail.transaction.deleted_reason}
                            </p>
                          </div>
                        )}
                        {ppobItem && (
                          <div className="rounded-lg border p-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Status PPOB
                            </p>
                            {ppobItem.ppob_message && (
                              <p className="mt-2 text-sm leading-relaxed">{ppobItem.ppob_message}</p>
                            )}
                            {ppobItem.ppob_serial_number && (
                              <p className="mt-2 font-mono text-xs text-muted-foreground">
                                SN: {ppobItem.ppob_serial_number}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}
              </div>
            </ScrollArea>

            <div className="border-t bg-muted/30 px-4 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap gap-2">
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
                <div className="flex flex-wrap gap-2 xl:justify-end">
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
                  {hasRefundAction && (
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
            </div>
          </>
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
                <SelectItem value="debit">{id.payment.debit}</SelectItem>
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
