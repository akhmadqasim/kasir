import { useNavigate } from "react-router-dom"
import { Eye, Printer, RotateCcw } from "lucide-react"
import { Button, Spinner } from "@heroui/react"

import { toast } from "@/lib/toast"
import { useSingleFlight } from "@/hooks/use-single-flight"
import { errorMessage } from "@/lib/api/client"
import { printReceipt } from "@/lib/api/printers"
import { id } from "@/i18n/id"
import { refundActionBlockedReason } from "@/lib/refund-window"
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
  // is dropped, so the receipt prints once.
  const { isPending: isPrinting, run: runPrint } = useSingleFlight()
  const isDeleted = txn.status === "deleted"
  // A failed top-up still owed keeps the refund open past the seven days. The
  // button opens the refund page, which keeps the exchange option closed then.
  const blockedReason = refundActionBlockedReason(txn.created_at, {
    hasRefundableFailedPpob: txn.has_refundable_failed_ppob,
    action: "refund",
  })

  // Printing happens on the server: the thermal printer is plugged into the till
  // the server runs on, so this produces paper there whichever device pressed it.
  const handlePrint = () =>
    runPrint(async () => {
      try {
        await printReceipt(txn.id)
        toast.success(id.print.printed)
      } catch (e) {
        toast.error(id.print.failed(errorMessage(e)))
      }
    })

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
      {/* Gated on `has_refundable_goods` from the server, not on the channel
          or the status: a failed top-up bought on the PPOB page comes back too,
          and a mixed cart whose goods all came back is still `partial_refund`.
          The refund page sets aside the lines that cannot come back. */}
      {txn.has_refundable_goods && !isDeleted && (
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
