import { MoreHorizontal, Pencil, Printer, RefreshCcw, RotateCcw, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  AlertDialog,
  Button,
  Dropdown,
  Label,
  Modal,
  Skeleton,
  Spinner,
  Surface,
  Table,
  TextArea,
  TextField,
  Tooltip,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { InfoPanel } from "@/components/info-panel"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { SendWhatsappButton } from "@/features/whatsapp"
import { useApiQuery } from "@/hooks/use-api"
import { getWhatsappSends } from "@/lib/api/whatsapp"
import {
  getTransactionDetail,
  retryPpobFulfillment,
  updateTransactionPaymentMethod,
  voidTransaction,
} from "@/lib/api/transactions"
import { printPpobReceipt, printReceipt } from "@/lib/api/printers"
import { errorMessage } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
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
import { isDiscountedLine, lineDiscountAmount, netLineAmount } from "../line-amounts"
import {
  isPpobInFlight,
  isPpobPrintable,
  isPpobRetryable,
  ppobStatusConfig,
} from "../ppob-status"
import { refundBlockedReason } from "../refund-window"
import type { TransactionDetail, TransactionListItem } from "../types"

const PAYMENT_METHOD_OPTIONS = SELECTABLE_PAYMENT_METHODS.map((method) => ({
  key: method,
  label: paymentMethodLabel(method),
}))

interface TransactionDetailDialogProps {
  transaction: TransactionListItem | null
  onClose: () => void
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
    <Button isDisabled={blockedReason !== null} variant="secondary" onPress={onRefund}>
      <RotateCcw />
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
  const [isPrintingPpob, setIsPrintingPpob] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteReason, setDeleteReason] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [showEditPayment, setShowEditPayment] = useState(false)
  const [newPaymentMethod, setNewPaymentMethod] = useState("")
  const [editPaymentReason, setEditPaymentReason] = useState("")
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false)

  const { data: detail, isLoading } = useApiQuery<TransactionDetail>(
    queryKeys.transactions.detail(transaction?.id ?? 0),
    () => getTransactionDetail(transaction!.id),
    { enabled: !!transaction },
  )

  // "Terkirim ke 0812...": the most recent successful WhatsApp send, if any.
  const { data: whatsappSends } = useApiQuery(
    queryKeys.whatsapp.sends(transaction?.id ?? 0),
    () => getWhatsappSends(transaction!.id),
    { enabled: !!transaction },
  )
  const lastWhatsappSend = whatsappSends?.find((send) => send.status === "sent")

  const ppobItem = detail?.items.find((item) => item.service_type)
  const ppobCanRetry = isPpobRetryable(ppobItem?.ppob_status)
  const ppobPrintableItems =
    detail?.items.filter((item) => isPpobPrintable(item.ppob_status)) ?? []
  const isDeleted = detail?.transaction.status === "deleted"
  const hasRefundAction =
    !!detail && !detail.has_ppob && detail.transaction.status !== "refunded" && !isDeleted
  const refundBlocked = detail ? refundBlockedReason(detail.transaction.created_at) : null
  const isSplitPayment = (detail?.payment_breakdown.length ?? 0) > 1
  const originalTotalAmount = detail
    ? Math.max(detail.transaction.subtotal_amount - detail.transaction.discount_amount, 0)
    : 0

  // Dua daftar karena rincian split, kalau ada, duduk di antara metode dan jumlah bayar.
  const paymentItems: SummaryItem[] = detail
    ? [
        ...(detail.transaction.discount_amount > 0
          ? [
              { label: "Subtotal", value: formatRupiah(detail.transaction.subtotal_amount) },
              {
                label: "Diskon",
                value: `-${formatRupiah(detail.transaction.discount_amount)}`,
                tone: "danger" as const,
              },
            ]
          : []),
        {
          label: id.transactions.totalAmount,
          value: formatRupiah(detail.transaction.total_amount),
          tone: "strong",
        },
        ...(isDeleted
          ? [{ label: "Total sebelum hapus", value: formatRupiah(originalTotalAmount) }]
          : []),
        {
          label: id.transactions.paymentMethod,
          value: paymentSplitLabel(
            detail.transaction.payment_method,
            detail.payment_breakdown[0]?.bank_name,
          ),
        },
      ]
    : []
  const settlementItems: SummaryItem[] = detail
    ? [
        {
          label: id.transactions.paymentAmount,
          value: formatRupiah(detail.transaction.payment_amount),
        },
        ...((detail.transaction.change_amount ?? 0) > 0
          ? [
              {
                label: id.transactions.changeAmount,
                value: formatRupiah(detail.transaction.change_amount ?? 0),
              },
            ]
          : []),
      ]
    : []

  const handlePrint = async () => {
    if (!transaction) return
    try {
      await printReceipt(transaction.id)
      toast.success("Struk dicetak")
    } catch (e) {
      toast.error(`Gagal cetak: ${errorMessage(e)}`)
    }
  }

  // Satu struk per baris PPOB yang berhasil, bukan hanya baris pertama:
  // satu keranjang bisa memuat dua pembelian PPOB dan masing-masing punya
  // token sendiri yang dibawa pelanggan.
  const handlePrintPpobReceipt = async () => {
    if (ppobPrintableItems.length === 0) return
    setIsPrintingPpob(true)
    try {
      for (const item of ppobPrintableItems) {
        await printPpobReceipt(item.id)
      }
      toast.success(
        ppobPrintableItems.length > 1
          ? `${ppobPrintableItems.length} struk PPOB dicetak`
          : "Struk PPOB dicetak",
      )
    } catch (e) {
      toast.error(`Gagal cetak struk PPOB: ${errorMessage(e)}`)
    } finally {
      setIsPrintingPpob(false)
    }
  }

  const handleRetryPpob = async () => {
    if (!ppobItem) return
    setIsRetrying(true)
    try {
      await retryPpobFulfillment(ppobItem.id)
      toast.success("PPOB sedang diproses ulang di latar belakang")
      // One prefix covers both the detail and the list; both live under
      // `["transactions", ...]`.
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
    } catch (e) {
      toast.error(`Gagal retry: ${errorMessage(e)}`)
    } finally {
      setIsRetrying(false)
    }
  }

  const handleDelete = async () => {
    if (!transaction) return
    if (!deleteReason.trim()) {
      toast.error(id.transactions.reasonRequired)
      return
    }
    setIsDeleting(true)
    try {
      await voidTransaction(transaction.id, deleteReason.trim())
      toast.success(id.transactions.deleteSuccess)
      setShowDeleteConfirm(false)
      setDeleteReason("")
      onClose()
      // Voiding a sale puts the stock back and changes every net figure.
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleUpdatePaymentMethod = async () => {
    if (!transaction) return
    if (!editPaymentReason.trim()) {
      toast.error(id.transactions.reasonRequired)
      return
    }
    setIsUpdatingPayment(true)
    try {
      await updateTransactionPaymentMethod(
        transaction.id,
        newPaymentMethod,
        editPaymentReason.trim(),
      )
      toast.success(id.transactions.editPaymentSuccess)
      setShowEditPayment(false)
      setNewPaymentMethod("")
      setEditPaymentReason("")
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      // The payment-method report and the shift's drawer both read this.
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setIsUpdatingPayment(false)
    }
  }

  return (
    <>
      <Modal.Backdrop isOpen={!!transaction} onOpenChange={(open) => !open && onClose()}>
        <Modal.Container scroll="inside" size="lg">
          <Modal.Dialog aria-label={id.transactions.detail}>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{id.transactions.detail}</Modal.Heading>
            </Modal.Header>

            {isLoading || !detail ? (
              <Modal.Body>
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </Modal.Body>
            ) : (
              <>
                <Modal.Body>
                  {/* Bagian dipisah ruang, bukan garis — DESIGN.md §5.7. Judul
                      bagiannya `text-foreground` karena Body bawaannya muted. */}
                  <section className="flex flex-col gap-2">
                    {/* Status adalah lencana sungguhan (DESIGN.md §5.4), jadi ia duduk di
                        kepala bagian, bukan dipaksa jadi teks di dalam `SummaryList`. */}
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground">Ringkasan Transaksi</p>
                      <StatusBadge status={transactionStatusVariant(detail.transaction.status)}>
                        {transactionStatusLabel(detail.transaction.status)}
                      </StatusBadge>
                    </div>
                    <SummaryList
                      items={[
                        {
                          label: id.transactions.receiptNumber,
                          value: detail.transaction.receipt_number,
                          tone: "mono",
                        },
                        {
                          label: id.transactions.date,
                          value: formatDateTime(detail.transaction.created_at),
                        },
                        { label: id.transactions.cashier, value: detail.cashier_name },
                      ]}
                    />
                  </section>

                  {/* `Table` seperti di dialog detail refund, bukan grid yang
                      menirukan tabel — DESIGN.md §5.4. */}
                  <section className="flex flex-col gap-2">
                    <p className="font-medium text-foreground">{id.transactions.itemList}</p>
                    <Table variant="secondary">
                      <Table.ScrollContainer>
                        <Table.Content aria-label={id.transactions.itemList}>
                          <Table.Header>
                            <Table.Column isRowHeader>Item</Table.Column>
                            <Table.Column className="text-center">Qty</Table.Column>
                            <Table.Column className="text-right">Subtotal</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {detail.items.map((item) => {
                              const ppobStatus = ppobStatusConfig(item.ppob_status)
                              return (
                                <Table.Row key={item.id} id={item.id} textValue={item.product_name}>
                                  <Table.Cell className="whitespace-normal">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium">{item.product_name}</span>
                                      {ppobStatus && (
                                        <StatusBadge size="sm" status={ppobStatus.variant}>
                                          {isPpobInFlight(item.ppob_status) && (
                                            <Spinner className="size-3" color="current" size="sm" />
                                          )}
                                          {ppobStatus.label}
                                        </StatusBadge>
                                      )}
                                    </div>
                                    {isDiscountedLine(item) && (
                                      <p className="text-xs text-danger">
                                        Diskon -{formatRupiah(lineDiscountAmount(item))}
                                      </p>
                                    )}
                                  </Table.Cell>
                                  <Table.Cell className="text-center tabular-nums">
                                    {item.quantity}
                                  </Table.Cell>
                                  <Table.Cell className="text-right tabular-nums">
                                    {isDiscountedLine(item) && (
                                      <p className="text-xs text-muted line-through">
                                        {formatRupiah(item.subtotal)}
                                      </p>
                                    )}
                                    <p className="font-medium">
                                      {formatRupiah(netLineAmount(item))}
                                    </p>
                                  </Table.Cell>
                                </Table.Row>
                              )
                            })}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </section>

                  <section className="flex flex-col gap-2">
                    <p className="font-medium text-foreground">Ringkasan Pembayaran</p>
                    <InfoPanel className="flex flex-col gap-2">
                      <SummaryList items={paymentItems} />
                      {detail.payment_breakdown.length > 1 && (
                        /* Bersarang di dalam kotak `secondary`, jadi memakai `default`
                           supaya rinciannya masih terlihat sebagai kotak tersendiri. */
                        <Surface className="px-3 py-2" variant="default">
                          <SummaryList
                            items={detail.payment_breakdown.map((split) => ({
                              label: paymentSplitLabel(split.payment_method, split.bank_name),
                              value: formatRupiah(split.amount),
                            }))}
                          />
                        </Surface>
                      )}
                      <SummaryList items={settlementItems} />
                    </InfoPanel>
                  </section>

                  {(detail.transaction.notes ||
                    detail.transaction.deleted_reason ||
                    ppobItem ||
                    lastWhatsappSend) && (
                    <section className="flex flex-col gap-2">
                      <p className="font-medium text-foreground">Info Tambahan</p>
                      {lastWhatsappSend && (
                        <InfoPanel className="flex flex-col gap-1">
                          <p className="text-xs">WhatsApp</p>
                          <p className="text-foreground">
                            {id.whatsapp.lastSentTo(lastWhatsappSend.phone)}
                          </p>
                        </InfoPanel>
                      )}
                      {detail.transaction.notes && (
                        <InfoPanel className="flex flex-col gap-1">
                          <p className="text-xs">{id.transactions.notes}</p>
                          <p className="text-foreground">{detail.transaction.notes}</p>
                        </InfoPanel>
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
                        <InfoPanel className="flex flex-col gap-1">
                          <p className="text-xs">Status PPOB</p>
                          {ppobItem.ppob_message && (
                            <p className="text-foreground">{ppobItem.ppob_message}</p>
                          )}
                          {ppobItem.ppob_serial_number && (
                            <p className="font-mono text-xs">SN: {ppobItem.ppob_serial_number}</p>
                          )}
                          {isPpobInFlight(ppobItem.ppob_status) && (
                            <p className="text-xs">
                              Masih diproses ke penyedia. Tunggu hasilnya — retry baru bisa
                              dilakukan kalau statusnya gagal.
                            </p>
                          )}
                        </InfoPanel>
                      )}
                    </section>
                  )}
                </Modal.Body>

                {/* Admin corrections (void, change payment method) are rare and one of
                    them is destructive, so they live in a menu on the left, apart from
                    the everyday actions on the right — hence `justify-between`. */}
                <Modal.Footer className={cn(isAdmin && !isDeleted && "justify-between")}>
                  {isAdmin && !isDeleted && (
                    <Dropdown>
                      <Button aria-label="Aksi lainnya" isIconOnly variant="tertiary">
                        <MoreHorizontal />
                      </Button>
                      <Dropdown.Popover>
                        <Dropdown.Menu
                          onAction={(key) => {
                            if (key === "edit-payment") {
                              // `mixed` is not one of the options and the backend rejects
                              // it, so leave the select empty and make the admin pick a
                              // real method instead of pre-filling an invalid one.
                              setNewPaymentMethod(
                                isSelectablePaymentMethod(detail.transaction.payment_method)
                                  ? detail.transaction.payment_method
                                  : "",
                              )
                              setShowEditPayment(true)
                            } else if (key === "delete") {
                              setShowDeleteConfirm(true)
                            }
                          }}
                        >
                          <Dropdown.Item
                            id="edit-payment"
                            textValue={id.transactions.editPaymentMethod}
                          >
                            <Pencil className="size-4 shrink-0 text-muted" />
                            <Label>{id.transactions.editPaymentMethod}</Label>
                          </Dropdown.Item>
                          <Dropdown.Item id="delete" textValue={id.common.delete} variant="danger">
                            <Trash2 className="size-4 shrink-0 text-danger" />
                            <Label>{id.common.delete}</Label>
                          </Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                  )}
                  <div className="flex items-center gap-2">
                    {ppobCanRetry && (
                      <PendingButton
                        isPending={isRetrying}
                        variant="secondary"
                        onPress={handleRetryPpob}
                      >
                        <RefreshCcw />
                        Retry PPOB
                      </PendingButton>
                    )}
                    {ppobPrintableItems.length > 0 && (
                      <PendingButton
                        isPending={isPrintingPpob}
                        variant="secondary"
                        onPress={handlePrintPpobReceipt}
                      >
                        <Printer />
                        Cetak Struk PPOB
                      </PendingButton>
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
                    <SendWhatsappButton transactionId={detail.transaction.id} />
                    <Button onPress={handlePrint}>
                      <Printer />
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
        isKeyboardDismissDisabled={false}
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
            <AlertDialog.Body>
              <p>{id.transactions.deleteConfirm}</p>
              <TextField
                fullWidth
                value={deleteReason}
                variant="secondary"
                onChange={setDeleteReason}
              >
                <Label>{id.transactions.deleteReason}</Label>
                <TextArea placeholder={id.transactions.deleteReasonPlaceholder} rows={3} />
              </TextField>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              {/* Closing through the backdrop's `onOpenChange` already clears the reason. */}
              <Button isDisabled={isDeleting} slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <PendingButton
                isDisabled={!deleteReason.trim()}
                isPending={isDeleting}
                variant="danger"
                onPress={handleDelete}
              >
                {id.common.delete}
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* Edit Payment Method Dialog */}
      <Modal.Backdrop isOpen={showEditPayment} onOpenChange={setShowEditPayment}>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label={id.transactions.editPaymentMethod}>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{id.transactions.editPaymentMethod}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {isSplitPayment && (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      Transaksi ini dibayar dengan beberapa metode. Menyimpan metode tunggal akan
                      mengganti seluruh rincian pembayarannya menjadi satu baris sebesar total
                      transaksi.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              <OptionSelect
                fullWidth
                label={id.transactions.paymentMethod}
                options={PAYMENT_METHOD_OPTIONS}
                placeholder="Pilih metode pembayaran"
                value={newPaymentMethod || null}
                variant="secondary"
                onChange={(key) => setNewPaymentMethod(key ?? "")}
              />
              <TextField
                fullWidth
                value={editPaymentReason}
                variant="secondary"
                onChange={setEditPaymentReason}
              >
                <Label>{id.transactions.editPaymentReason}</Label>
                <TextArea placeholder={id.transactions.editPaymentReasonPlaceholder} rows={3} />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="tertiary"
                onPress={() => {
                  setEditPaymentReason("")
                  setShowEditPayment(false)
                }}
              >
                {id.common.cancel}
              </Button>
              <PendingButton
                isDisabled={
                  !editPaymentReason.trim() || !isSelectablePaymentMethod(newPaymentMethod)
                }
                isPending={isUpdatingPayment}
                onPress={handleUpdatePaymentMethod}
              >
                {id.common.save}
              </PendingButton>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
