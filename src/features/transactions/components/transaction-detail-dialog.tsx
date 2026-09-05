import { Loader2, Pencil, Printer, RefreshCcw, RotateCcw, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  AlertDialog,
  Button,
  Label,
  ListBox,
  Modal,
  Select,
  Separator,
  Skeleton,
  TextArea,
  TextField,
  Tooltip,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { selectedText } from "@/components/selected-text"
import { StatusBadge } from "@/components/status-badge"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { useAuthStore } from "@/features/auth"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  SELECTABLE_PAYMENT_METHODS,
  isSelectablePaymentMethod,
  paymentMethodLabel,
  paymentSplitLabel,
  transactionStatusLabel,
  transactionStatusVariant,
} from "@/lib/labels"
import { id } from "@/i18n/id"
import {
  isDiscountedLine,
  lineDiscountAmount,
  netLineAmount,
} from "../line-amounts"
import { isPpobInFlight, isPpobRetryable, ppobStatusConfig } from "../ppob-status"
import { refundBlockedReason } from "../refund-window"
import type { TransactionDetail, TransactionListItem } from "../types"

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
      <span className="text-muted">{label}</span>
      <span className={cn("min-w-0 text-right font-medium", mono && "font-mono", valueClassName)}>{value}</span>
    </div>
  )
}

/**
 * Refund entry point. Past the seven-day window the backend rejects the refund
 * outright, so the button is disabled here with the reason attached — a disabled
 * button eats pointer events, hence the wrapper the tooltip hangs off. HeroUI
 * renders that wrapper as `div[role=button][tabindex=0]`, so unlike the old
 * `<span>` the reason is now reachable without a mouse.
 */
function RefundAction({
  blockedReason,
  onRefund,
}: {
  blockedReason: string | null
  onRefund: () => void
}) {
  const button = (
    <Button isDisabled={blockedReason !== null} size="sm" variant="outline" onPress={onRefund}>
      <RotateCcw className="mr-2 h-4 w-4" />
      {id.refund.title}
    </Button>
  )

  if (!blockedReason) return button

  return (
    <Tooltip>
      <Tooltip.Trigger className="inline-flex">{button}</Tooltip.Trigger>
      <Tooltip.Content>{blockedReason}</Tooltip.Content>
    </Tooltip>
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
  const ppobCanRetry = isPpobRetryable(ppobItem?.ppob_status)
  const isDeleted = detail?.transaction.status === "deleted"
  const hasRefundAction = !!detail && !detail.has_ppob && detail.transaction.status !== "refunded" && !isDeleted
  const refundBlocked = detail ? refundBlockedReason(detail.transaction.created_at) : null
  const isSplitPayment = (detail?.payment_breakdown.length ?? 0) > 1
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
    <>
      <Modal.Backdrop isOpen={!!transaction} onOpenChange={(open) => !open && onClose()}>
        <Modal.Container scroll="inside" size="md">
          <Modal.Dialog aria-label={id.transactions.detail}>
            <Modal.Header className="border-b">
              <Modal.Heading>{id.transactions.detail}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>

            {isLoading || !detail ? (
              <Modal.Body className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </Modal.Body>
            ) : (
              <>
                <Modal.Body className="space-y-4">
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
                          <StatusBadge status={transactionStatusVariant(detail.transaction.status)}>
                            {transactionStatusLabel(detail.transaction.status)}
                          </StatusBadge>
                        )}
                        rowClassName="items-center"
                      />
                    </div>
                  </section>

                  <Separator />

                  <section className="space-y-2.5">
                    <h3 className="text-sm font-semibold">{id.transactions.itemList}</h3>
                    <div className="rounded-lg border">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b bg-default/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                        <span>Item</span>
                        <span className="text-right">Subtotal</span>
                      </div>
                      <div className="divide-y">
                        {detail.items.map((item) => {
                          const ppobStatus = ppobStatusConfig(item.ppob_status)
                          return (
                            <div
                              key={item.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-2.5 text-sm"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium break-words">{item.product_name}</span>
                                  <span className="text-muted">× {item.quantity}</span>
                                  {ppobStatus && (
                                    <StatusBadge size="sm" status={ppobStatus.variant}>
                                      {isPpobInFlight(item.ppob_status) && (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      )}
                                      {ppobStatus.label}
                                    </StatusBadge>
                                  )}
                                </div>
                                {isDiscountedLine(item) && (
                                  <p className="text-xs text-danger">
                                    Diskon: -{formatRupiah(lineDiscountAmount(item))}
                                  </p>
                                )}
                              </div>
                              <div className="text-right tabular-nums">
                                {isDiscountedLine(item) && (
                                  <div className="text-xs text-muted line-through">
                                    {formatRupiah(item.subtotal)}
                                  </div>
                                )}
                                <div className="font-medium">
                                  {formatRupiah(netLineAmount(item))}
                                </div>
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
                    <div className="rounded-lg border bg-default/20 p-4">
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
                              valueClassName="tabular-nums text-danger"
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
                          value={paymentSplitLabel(
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
                                  label={paymentSplitLabel(split.payment_method, split.bank_name)}
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
                              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                                {id.transactions.notes}
                              </p>
                              <p className="mt-2 text-sm leading-relaxed">{detail.transaction.notes}</p>
                            </div>
                          )}
                          {detail.transaction.deleted_reason && (
                            <Alert status="danger">
                              <Alert.Indicator />
                              <Alert.Content>
                                <Alert.Title>Alasan Penghapusan</Alert.Title>
                                <Alert.Description>
                                  {detail.transaction.deleted_reason}
                                </Alert.Description>
                              </Alert.Content>
                            </Alert>
                          )}
                          {ppobItem && (
                            <div className="rounded-lg border p-4">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                                Status PPOB
                              </p>
                              {ppobItem.ppob_message && (
                                <p className="mt-2 text-sm leading-relaxed">{ppobItem.ppob_message}</p>
                              )}
                              {ppobItem.ppob_serial_number && (
                                <p className="mt-2 font-mono text-xs text-muted">
                                  SN: {ppobItem.ppob_serial_number}
                                </p>
                              )}
                              {isPpobInFlight(ppobItem.ppob_status) && (
                                <p className="mt-2 text-xs text-muted">
                                  Masih diproses ke penyedia. Tunggu hasilnya — retry
                                  baru bisa dilakukan kalau statusnya gagal.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    </>
                  )}
                </Modal.Body>

                <Modal.Footer className="flex-col items-stretch gap-3 border-t bg-default/30 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {isAdmin && !isDeleted && (
                      <Button
                        size="sm"
                        variant="danger"
                        onPress={() => setShowDeleteConfirm(true)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {id.common.delete}
                      </Button>
                    )}
                    {isAdmin && !isDeleted && (
                      <Button
                        size="sm"
                        variant="outline"
                        onPress={() => {
                          // `mixed` is not one of the options and the backend rejects
                          // it, so leave the select empty and make the admin pick a
                          // real method instead of pre-filling an invalid one.
                          setNewPaymentMethod(
                            isSelectablePaymentMethod(detail.transaction.payment_method)
                              ? detail.transaction.payment_method
                              : ""
                          )
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
                        isDisabled={isRetrying}
                        size="sm"
                        variant="outline"
                        onPress={handleRetryPpob}
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
                      <RefundAction
                        blockedReason={refundBlocked}
                        onRefund={() => {
                          onClose()
                          navigate(`/refund/${detail.transaction.id}`)
                        }}
                      />
                    )}
                    <Button size="sm" onPress={handlePrint}>
                      <Printer className="mr-2 h-4 w-4" />
                      {id.transactions.printReceipt}
                    </Button>
                  </div>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Delete Confirmation Dialog */}
      <AlertDialog.Backdrop
        isOpen={showDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteReason("")
            setShowDeleteConfirm(false)
          }
        }}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.transactions.deleteTransaction}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.transactions.deleteTransaction}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm text-muted">{id.transactions.deleteConfirm}</p>
              <TextField
                aria-label={id.transactions.deleteReason}
                fullWidth
                value={deleteReason}
                onChange={setDeleteReason}
              >
                <TextArea
                  placeholder={id.transactions.deleteReasonPlaceholder}
                  rows={3}
                />
              </TextField>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isDeleting}
                variant="outline"
                onPress={() => { setDeleteReason(""); setShowDeleteConfirm(false) }}
              >
                {id.common.cancel}
              </Button>
              <Button
                isDisabled={isDeleting || !deleteReason.trim()}
                variant="danger"
                onPress={handleDelete}
              >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {id.common.delete}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* Edit Payment Method Dialog */}
      <Modal.Backdrop isOpen={showEditPayment} onOpenChange={setShowEditPayment}>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label={id.transactions.editPaymentMethod}>
            <Modal.Header>
              <Modal.Heading>{id.transactions.editPaymentMethod}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-4">
              {isSplitPayment && (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      Transaksi ini dibayar dengan beberapa metode. Menyimpan metode
                      tunggal akan mengganti seluruh rincian pembayarannya menjadi satu
                      baris sebesar total transaksi.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              <Select
                aria-label={id.transactions.paymentMethod}
                fullWidth
                placeholder="Pilih metode pembayaran"
                value={newPaymentMethod || null}
                onChange={(value) => setNewPaymentMethod(value === null ? "" : String(value))}
              >
                <Select.Trigger>
                  <Select.Value>{selectedText}</Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {SELECTABLE_PAYMENT_METHODS.map((method) => (
                      <ListBox.Item
                        key={method}
                        id={method}
                        textValue={paymentMethodLabel(method)}
                      >
                        <Label>{paymentMethodLabel(method)}</Label>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField
                aria-label={id.transactions.editPaymentReason}
                fullWidth
                value={editPaymentReason}
                onChange={setEditPaymentReason}
              >
                <TextArea
                  placeholder={id.transactions.editPaymentReasonPlaceholder}
                  rows={3}
                />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="outline"
                onPress={() => { setEditPaymentReason(""); setShowEditPayment(false) }}
              >
                {id.common.cancel}
              </Button>
              <Button
                isDisabled={
                  isUpdatingPayment ||
                  !editPaymentReason.trim() ||
                  !isSelectablePaymentMethod(newPaymentMethod)
                }
                onPress={handleUpdatePaymentMethod}
              >
                {isUpdatingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {id.common.save}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
