import { Button, Kbd, Modal } from "@heroui/react"
import { CircleCheck, CircleX, Clock, Printer, TriangleAlert } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { ChangeTotalPanel } from "@/features/cashier/components/change-total-panel"
import type { TransactionResult } from "@/features/cashier/types"
import { AutoPrintStatus, useReceiptPrint } from "@/features/receipt"
import { PpobLineResult } from "@/features/transactions/components/ppob-line-result"
import { usePpobCheck } from "@/features/transactions/hooks/use-ppob-check"
import { usePpobSaleProgress } from "@/features/transactions/hooks/use-ppob-sale-progress"
import { cn } from "@/lib/utils"

interface PpobResultDialogProps {
  open: boolean
  result: TransactionResult | null
  /** `undefined` while the printer settings are still loading. */
  autoPrint: boolean | undefined
  onDone: () => void
}

/**
 * The header icon follows the provider's answer, not the payment — the money
 * is always in by now, so what the cashier needs from a glance is whether the
 * token arrived. The same states `StatusBadge` names in words below it.
 */
function statusIcon(status: string) {
  switch (status) {
    case "success":
      return { Icon: CircleCheck, tint: "bg-success-soft text-success-soft-foreground" }
    case "failed":
      return { Icon: CircleX, tint: "bg-danger-soft text-danger-soft-foreground" }
    case "uncertain":
      return { Icon: TriangleAlert, tint: "bg-warning-soft text-warning-soft-foreground" }
    default:
      return { Icon: Clock, tint: "bg-default text-foreground" }
  }
}

/**
 * The purchase is paid; this is what happened to it upstream.
 *
 * Checkout answers before the provider does — the line comes back `pending`
 * and a background task chases it — so the detail is polled while that call
 * is in flight. What the customer is waiting for is on it: the token or serial
 * number, which the struk then carries.
 */
export function PpobResultDialog({ open, result, autoPrint, onDone }: PpobResultDialogProps) {
  if (!result) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={() => onDone()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Transaksi PPOB selesai">
          {/* `key` rebuilds the polling and the auto-print for the next purchase. */}
          <ResultContent
            key={result.transaction.id}
            result={result}
            autoPrint={autoPrint}
            onDone={onDone}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface ResultContentProps extends Omit<PpobResultDialogProps, "open" | "result"> {
  result: TransactionResult
}

function ResultContent({ result, autoPrint, onDone }: ResultContentProps) {
  const { transaction } = result

  const { lines, inFlight, uncertain } = usePpobSaleProgress(result)
  const status = lines[0]?.ppob_status ?? "pending"
  const { check, checkingId } = usePpobCheck()
  const { Icon: StatusIcon, tint } = statusIcon(status)

  // Enter prints from anywhere in the dialog; Esc (Modal's own) is "Selesai".
  // Auto-print waits for a final answer from the server: not while in flight,
  // and not while uncertain either; an uncertain line that turns success
  // prints then.
  const {
    isPrinting,
    print: handlePrint,
    autoPrintState,
    printButtonRef,
  } = useReceiptPrint(transaction.id, {
    autoPrint: autoPrint && !inFlight && !uncertain,
    shortcuts: {},
  })

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Icon className={cn("transition-colors", tint)}>
          <StatusIcon className="size-5" />
        </Modal.Icon>
        <Modal.Heading>Transaksi PPOB selesai</Modal.Heading>
      </Modal.Header>
      <Modal.Body className="overflow-visible">
        <ChangeTotalPanel
          changeAmount={transaction.change_amount}
          totalAmount={transaction.total_amount}
        />

        {lines.map((line) => (
          <PpobLineResult
            key={line.id}
            checkingId={checkingId}
            line={line}
            onCheck={(itemId) => void check(itemId)}
          />
        ))}

        {/* One live region for the auto-print, so its progress is announced too.
            Always in the tree: a region that starts out display:none is not
            reliably watched. Empty, it is taken out of the flow (no extra gap). */}
        <div aria-live="polite" className="empty:absolute">
          <AutoPrintStatus state={autoPrintState} />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <PendingButton
          ref={printButtonRef}
          isPending={isPrinting}
          variant="tertiary"
          onPress={handlePrint}
        >
          <Printer />
          Cetak struk
          <Kbd aria-hidden="true" variant="light">
            <Kbd.Content>Enter</Kbd.Content>
          </Kbd>
        </PendingButton>
        <Button autoFocus onPress={onDone}>
          Selesai
          <Kbd aria-hidden="true" className="text-accent-foreground" variant="light">
            <Kbd.Content>Esc</Kbd.Content>
          </Kbd>
        </Button>
      </Modal.Footer>
    </>
  )
}
