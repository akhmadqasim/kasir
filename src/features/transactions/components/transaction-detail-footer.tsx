import { useNavigate } from "react-router-dom"
import { Printer, RefreshCcw, RotateCcw } from "lucide-react"
import { Button, Modal } from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { useSingleFlight } from "@/hooks/use-single-flight"
import { errorMessage } from "@/lib/api/client"
import { printPpobReceipt, printReceipt } from "@/lib/api/printers"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import { isPpobPrintable } from "@/lib/ppob-status"
import { refundActionBlockedReason } from "@/lib/refund-window"
import type { TransactionDetail } from "../types"
import { RefundButton } from "./refund-button"
import { TransactionAdminMenu } from "./transaction-admin-menu"

interface TransactionDetailFooterProps {
  detail: TransactionDetail
  isAdmin: boolean
  /** At least one PPOB line failed and can be sent to the provider again. */
  canRetryPpob: boolean
  onRetryPpob: () => void
  onEditPayment: () => void
  onVoid: () => void
  /** Close the detail; the refund button leaves for the refund page. */
  onClose: () => void
}

/** Printing, refund, PPOB retry, and — for an admin — the correction menu. */
export function TransactionDetailFooter({
  detail,
  isAdmin,
  canRetryPpob,
  onRetryPpob,
  onEditPayment,
  onVoid,
  onClose,
}: TransactionDetailFooterProps) {
  const navigate = useNavigate()
  const { isPending: isPrinting, run: runPrint } = useSingleFlight()
  const { isPending: isPrintingPpob, run: runPrintPpob } = useSingleFlight()

  const { transaction } = detail
  const isDeleted = transaction.status === "deleted"
  const showAdminMenu = isAdmin && !isDeleted
  const ppobPrintableItems = detail.items.filter((item) => isPpobPrintable(item.ppob_status))
  // Same gate as the history row: the server decides whether any line is left
  // to return, a failed top-up on a PPOB-page sale included. Neither the
  // status nor the channel can tell.
  const hasRefundAction = detail.has_refundable_goods && !isDeleted

  const handlePrint = () =>
    runPrint(async () => {
      try {
        await printReceipt(transaction.id)
        toast.success(id.print.printed)
      } catch (e) {
        toast.error(id.print.failed(errorMessage(e)))
      }
    })

  // Satu struk per baris PPOB yang berhasil, bukan hanya baris pertama:
  // satu keranjang bisa memuat dua pembelian PPOB dan masing-masing punya
  // token sendiri yang dibawa pelanggan.
  const handlePrintPpobReceipt = () =>
    runPrintPpob(async () => {
      if (ppobPrintableItems.length === 0) return
      try {
        for (const item of ppobPrintableItems) {
          await printPpobReceipt(item.id)
        }
        toast.success(id.print.ppobPrinted(ppobPrintableItems.length))
      } catch (e) {
        toast.error(id.print.ppobFailed(errorMessage(e)))
      }
    })

  return (
    // The admin menu sits on the left, apart from the everyday actions on the
    // right — hence `justify-between`.
    <Modal.Footer className={cn(showAdminMenu && "justify-between")}>
      {showAdminMenu && <TransactionAdminMenu onEditPayment={onEditPayment} onVoid={onVoid} />}
      <div className="flex items-center gap-2">
        {canRetryPpob && (
          <Button variant="secondary" onPress={onRetryPpob}>
            <RefreshCcw />
            {id.ppobFulfillment.retryTitle}
          </Button>
        )}
        {ppobPrintableItems.length > 0 && (
          <PendingButton
            isPending={isPrintingPpob}
            variant="secondary"
            onPress={handlePrintPpobReceipt}
          >
            <Printer />
            {id.print.ppobReceipt}
          </PendingButton>
        )}
        {hasRefundAction && (
          <RefundButton
            // Opens the refund page, which keeps the exchange option closed
            // past the window even when a failed top-up is still owed.
            blockedReason={refundActionBlockedReason(transaction.created_at, {
              hasRefundableFailedPpob: detail.has_refundable_failed_ppob,
              action: "refund",
            })}
            variant="secondary"
            onPress={() => {
              onClose()
              navigate(`/refund/${transaction.id}`)
            }}
          >
            <RotateCcw />
            {id.refund.title}
          </RefundButton>
        )}
        <PendingButton isPending={isPrinting} onPress={handlePrint}>
          <Printer />
          {id.transactions.printReceipt}
        </PendingButton>
      </div>
    </Modal.Footer>
  )
}
