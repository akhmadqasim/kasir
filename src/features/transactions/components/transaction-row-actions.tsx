import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, Printer, RotateCcw } from "lucide-react"
import { Button, Spinner } from "@heroui/react"

import { toast } from "@/lib/toast"
import { errorMessage } from "@/lib/api/client"
import { printReceipt } from "@/lib/api/printers"
import { id } from "@/i18n/id"
import { refundBlockedReason } from "@/lib/refund-window"
import type { TransactionListItem } from "../types"
import { RefundButton } from "./refund-button"

interface TransactionRowActionsProps {
  txn: TransactionListItem
  onOpenDetail: () => void
}

/** Detail, refund and reprint for one history row, each named with the receipt number. */
export function TransactionRowActions({ txn, onOpenDetail }: TransactionRowActionsProps) {
  const navigate = useNavigate()
  // Per row: a second press while the first is still on its way to the printer
  // would otherwise print the receipt twice.
  const [isPrinting, setIsPrinting] = useState(false)
  const isDeleted = txn.status === "deleted"
  const blockedReason = refundBlockedReason(txn.created_at)

  // Printing happens on the server: the thermal printer is plugged into the till
  // the server runs on, so this produces paper there whichever device pressed it.
  const handlePrint = async () => {
    setIsPrinting(true)
    try {
      await printReceipt(txn.id)
      toast.success(id.print.printed)
    } catch (e) {
      toast.error(id.print.failed(errorMessage(e)))
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        aria-label={`Lihat detail ${txn.receipt_number}`}
        isIconOnly
        size="sm"
        variant="tertiary"
        onPress={onOpenDetail}
      >
        <Eye />
      </Button>
      {/* Gated on the channel, not `has_ppob`: a cashier cart may mix goods with
          PPOB lines, and those goods stay returnable. The refund page sets the
          PPOB lines aside itself. */}
      {txn.channel === "sales" && txn.status !== "refunded" && !isDeleted && (
        <RefundButton
          aria-label={
            blockedReason
              ? `${id.refund.title} ${txn.receipt_number}: ${blockedReason}`
              : `${id.refund.title} ${txn.receipt_number}`
          }
          blockedReason={blockedReason}
          isIconOnly
          size="sm"
          variant="tertiary"
          onPress={() => navigate(`/refund/${txn.id}`)}
        >
          <RotateCcw />
        </RefundButton>
      )}
      <Button
        aria-label={`${id.transactions.printReceipt} ${txn.receipt_number}`}
        isDisabled={txn.has_ppob && txn.status !== "completed" && !isDeleted}
        isIconOnly
        isPending={isPrinting}
        size="sm"
        variant="tertiary"
        onPress={handlePrint}
      >
        {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <Printer />)}
      </Button>
    </div>
  )
}
