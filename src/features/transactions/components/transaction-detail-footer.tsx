import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Printer, RefreshCcw, RotateCcw } from "lucide-react"
import { Button, Modal } from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { errorMessage } from "@/lib/api/client"
import { printPpobReceipt, printReceipt } from "@/lib/api/printers"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import { isPpobPrintable } from "@/lib/ppob-status"
import { refundBlockedReason } from "@/lib/refund-window"
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
  const [isPrinting, setIsPrinting] = useState(false)
  const [isPrintingPpob, setIsPrintingPpob] = useState(false)

  const { transaction } = detail
  const isDeleted = transaction.status === "deleted"
  const showAdminMenu = isAdmin && !isDeleted
  const ppobPrintableItems = detail.items.filter((item) => isPpobPrintable(item.ppob_status))
  // A mixed cart's goods stay returnable; the refund page itself sets the PPOB
  // lines aside. Only a sale with no physical line at all has nothing to refund.
  const hasRefundAction =
    detail.items.some((item) => item.product_id !== null) &&
    transaction.status !== "refunded" &&
    !isDeleted

  const handlePrint = async () => {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      await printReceipt(transaction.id)
      toast.success(id.print.printed)
    } catch (e) {
      toast.error(id.print.failed(errorMessage(e)))
    } finally {
      setIsPrinting(false)
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
      toast.success(id.print.ppobPrinted(ppobPrintableItems.length))
    } catch (e) {
      toast.error(id.print.ppobFailed(errorMessage(e)))
    } finally {
      setIsPrintingPpob(false)
    }
  }

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
            blockedReason={refundBlockedReason(transaction.created_at)}
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
