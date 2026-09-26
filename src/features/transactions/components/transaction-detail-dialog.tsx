import { useState } from "react"
import { Button, Modal, Skeleton } from "@heroui/react"

import { LoadError } from "@/components/load-error"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import { useApiQuery } from "@/hooks/use-api"
import { getTransactionDetail } from "@/lib/api/transactions"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuthStore } from "@/features/auth"
import { formatDateTime } from "@/lib/format"
import { transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { id } from "@/i18n/id"
import { isPpobRetryable } from "@/lib/ppob-status"
import type { TransactionDetail, TransactionItem, TransactionListItem } from "../types"
import { EditPaymentMethodDialog } from "./edit-payment-method-dialog"
import { PpobResolveDialog, type PpobResolveTarget } from "./ppob-resolve-dialog"
import { PpobRetryDialog } from "./ppob-retry-dialog"
import { TransactionDetailFooter } from "./transaction-detail-footer"
import { TransactionExtraInfo } from "./transaction-extra-info"
import { TransactionItemsTable } from "./transaction-items-table"
import { TransactionPaymentSummary } from "./transaction-payment-summary"
import { VoidTransactionDialog } from "./void-transaction-dialog"

/** The dialog stacked on top of the detail, if any. */
type SubDialog = "retry-ppob" | "resolve-ppob" | "void" | "edit-payment"

interface TransactionDetailDialogProps {
  transaction: TransactionListItem | null
  onClose: () => void
}

export function TransactionDetailDialog({ transaction, onClose }: TransactionDetailDialogProps) {
  // Keep showing the last transaction while the dialog animates out: the parent
  // clears `transaction` the moment it closes, and without this the body
  // collapsed to skeleton rows for the length of the exit animation.
  const [lastTransaction, setLastTransaction] = useState(transaction)
  if (transaction && transaction !== lastTransaction) setLastTransaction(transaction)
  const current = transaction ?? lastTransaction

  const isAdmin = useAuthStore((s) => s.user?.role === "admin")
  const [subDialog, setSubDialog] = useState<SubDialog | null>(null)
  // Outlives the resolve dialog's open state on purpose — see `PpobResolveDialog`.
  const [resolveTarget, setResolveTarget] = useState<PpobResolveTarget | null>(null)
  const closeSubDialog = () => setSubDialog(null)

  const {
    data: detail,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useApiQuery<TransactionDetail>(
    queryKeys.transactions.detail(current?.id ?? 0),
    () => getTransactionDetail(current!.id),
    { enabled: !!current },
  )

  // Every PPOB line, not just the first: one cart can hold two PPOB purchases,
  // and the second one failing must still be visible and retryable.
  const ppobItems = detail?.items.filter((item) => item.service_type) ?? []
  const ppobRetryableItems = ppobItems.filter((item) => isPpobRetryable(item.ppob_status))

  const openResolve = (item: TransactionItem, success: boolean) => {
    setResolveTarget({ item, success })
    setSubDialog("resolve-ppob")
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

            {error && !detail ? (
              <>
                <Modal.Body>
                  <LoadError
                    isRetrying={isFetching}
                    title={id.loadFailed.transactionDetail}
                    onRetry={() => void refetch()}
                  >
                    {error.message}
                  </LoadError>
                </Modal.Body>
                <Modal.Footer>
                  <Button slot="close" variant="tertiary">
                    {id.common.close}
                  </Button>
                </Modal.Footer>
              </>
            ) : isLoading || !detail ? (
              // Bentuk kasar isi yang akan datang: ringkasan, tabel item, pembayaran.
              <Modal.Body aria-busy="true">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-24 w-full" />
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
                      <h3 className="font-medium text-foreground">Ringkasan Transaksi</h3>
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

                  <TransactionItemsTable items={detail.items} />
                  <TransactionPaymentSummary detail={detail} />
                  <TransactionExtraInfo
                    detail={detail}
                    ppobItems={ppobItems}
                    onResolvePpob={openResolve}
                  />
                </Modal.Body>

                <TransactionDetailFooter
                  canRetryPpob={ppobRetryableItems.length > 0}
                  detail={detail}
                  isAdmin={isAdmin}
                  onClose={onClose}
                  onEditPayment={() => setSubDialog("edit-payment")}
                  onRetryPpob={() => setSubDialog("retry-ppob")}
                  onVoid={() => setSubDialog("void")}
                />
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <PpobRetryDialog
        isOpen={subDialog === "retry-ppob"}
        items={ppobRetryableItems}
        onClose={closeSubDialog}
      />
      <PpobResolveDialog
        isOpen={subDialog === "resolve-ppob"}
        target={resolveTarget}
        onClose={closeSubDialog}
      />
      {detail && (
        <>
          <VoidTransactionDialog
            isOpen={subDialog === "void"}
            transactionId={detail.transaction.id}
            onClose={closeSubDialog}
            onVoided={onClose}
          />
          <EditPaymentMethodDialog
            currentMethod={detail.transaction.payment_method}
            isOpen={subDialog === "edit-payment"}
            isSplitPayment={detail.payment_breakdown.length > 1}
            transactionId={detail.transaction.id}
            onClose={closeSubDialog}
          />
        </>
      )}
    </>
  )
}
