import { useCallback, useRef, type KeyboardEvent } from "react"

import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import { EMPTY_SCANNER_BURST, isScannerBurst, trackScannerBurst } from "@/lib/scanner-burst"

interface UseAmountEntryGuardArgs {
  /** `\` — fill the field's method with what is left to pay. */
  onRemainingAmount: () => void
  /** A scan landed in `method`'s field; its amount must be dropped. */
  onScanRejected: (method: string) => void
  /** A typed amount confirmed with Enter. */
  onSubmit: () => void
}

/**
 * The keys of an amount field. An Enter that closes a scanner burst empties
 * the amount instead of paying. The timing comes from `onKeyDown`, since
 * HeroUI's `TextField` passes on only the value; the digits are the field's.
 */
export function useAmountEntryGuard({
  onRemainingAmount,
  onScanRejected,
  onSubmit,
}: UseAmountEntryGuardArgs) {
  const entryRef = useRef(EMPTY_SCANNER_BURST)

  const resetAmountEntry = useCallback(() => {
    entryRef.current = EMPTY_SCANNER_BURST
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
        entryRef.current = trackScannerBurst(entryRef.current, "", event.timeStamp)
        return
      }

      event.preventDefault()

      const typedAmount = currentAmount != null ? String(currentAmount) : ""
      if (isScannerBurst({ ...entryRef.current, digits: typedAmount }, event.timeStamp)) {
        entryRef.current = EMPTY_SCANNER_BURST
        onScanRejected(method)
        toast.warning(id.cashier.scanIgnoredInField)
        return
      }

      onSubmit()
    },
    [onRemainingAmount, onScanRejected, onSubmit],
  )

  return { handleAmountKeyDown, resetAmountEntry }
}
