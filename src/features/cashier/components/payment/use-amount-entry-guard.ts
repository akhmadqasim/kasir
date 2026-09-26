import { useCallback, useRef, type KeyboardEvent } from "react"

import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import {
  EMPTY_AMOUNT_ENTRY_TIMING,
  isScannerBurstEntry,
  trackAmountEntry,
} from "../../payment-behavior"

interface UseAmountEntryGuardArgs {
  /** `\` — fill the field's method with what is left to pay. */
  onRemainingAmount: () => void
  /** A scan landed in `method`'s field; its amount must be dropped. */
  onScanRejected: (method: string) => void
  /** A typed amount confirmed with Enter. */
  onSubmit: () => void
}

/**
 * The keys of an amount field. A scanner is a keyboard: a burst of digits
 * plus Enter in an amount field must not close the sale. The timing comes
 * from `onKeyDown` (not `onChange`, as before `RupiahField`): HeroUI's
 * `TextField` only passes the value on, not the DOM event, so each
 * keystroke's `event.timeStamp` is taken here. An Enter that arrives inside
 * a scan burst is ignored and the amount emptied, so the cashier never
 * charges a barcode.
 */
export function useAmountEntryGuard({
  onRemainingAmount,
  onScanRejected,
  onSubmit,
}: UseAmountEntryGuardArgs) {
  const entryRef = useRef(EMPTY_AMOUNT_ENTRY_TIMING)

  const resetAmountEntry = useCallback(() => {
    entryRef.current = EMPTY_AMOUNT_ENTRY_TIMING
  }, [])

  const handleAmountKeyDown = useCallback(
    (method: string, currentAmount: number | null) => (event: KeyboardEvent<HTMLInputElement>) => {
      // `\` = Uang Pas: one key next to Enter, without leaving the digit row;
      // in an amount field it means nothing else.
      if (event.key === "\\") {
        event.preventDefault()
        onRemainingAmount()
        return
      }
      if (event.key !== "Enter") {
        entryRef.current = trackAmountEntry(entryRef.current, event.timeStamp)
        return
      }

      event.preventDefault()

      const typedAmount = currentAmount != null ? String(currentAmount) : ""
      if (
        isScannerBurstEntry({
          amount: typedAmount,
          ...entryRef.current,
          submittedAt: event.timeStamp,
        })
      ) {
        entryRef.current = EMPTY_AMOUNT_ENTRY_TIMING
        onScanRejected(method)
        toast.warning(id.cashier.scanIgnoredInAmount)
        return
      }

      onSubmit()
    },
    [onRemainingAmount, onScanRejected, onSubmit],
  )

  return { handleAmountKeyDown, resetAmountEntry }
}
