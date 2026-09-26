import { useEffect, useRef, useState } from "react"

import { errorMessage } from "@/lib/api/client"
import * as shiftsApi from "@/lib/api/shifts"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { withoutCashFlow } from "../utils"
import type { CashFlow, Shift, ShiftSummary } from "../types"

/**
 * The running summary of the shift about to be closed, loaded once the shift is
 * known. `null` means there is nothing to load (no open shift, or it has just
 * been closed), and whatever was loaded stays as it is.
 *
 * It takes the shift itself, not its id, and loads again whenever the store
 * hands over a new shift object — `fetchActiveShift` after a sale or a cash
 * flow elsewhere — so the totals follow what has been booked since. Loading
 * never writes to the shift store, so this cannot feed itself into a loop.
 */
export function useShiftSummary(shift: Shift | null) {
  const shiftId = shift?.id ?? null
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Bumped by `retry` to run the load effect again for the same shift.
  const [attempt, setAttempt] = useState(0)

  // Numbers every summary request; only the newest may write its answer. Two
  // deletes in quick succession each reload the summary, and the first reload,
  // read before the second delete, must not bring the second row back.
  const latestRequest = useRef(0)

  // The first load, and the retry on the error screen. A failure stays on the
  // page, with its message and a retry button, instead of flashing past as a
  // toast and leaving a dead end behind it.
  //
  // Keyed on the shift object, not only its id: a refreshed shift is a new
  // object with the same id, and that is exactly the case that must reload.
  useEffect(() => {
    if (shift === null) return
    const request = ++latestRequest.current
    let isCurrent = true
    shiftsApi
      .getShiftSummary(shift.id)
      .then((loaded) => {
        if (!isCurrent || request !== latestRequest.current) return
        setSummary(loaded)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (isCurrent) setLoadError(errorMessage(err))
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })
    return () => {
      isCurrent = false
    }
  }, [shift, attempt])

  const retry = () => {
    setIsLoading(true)
    setAttempt((count) => count + 1)
  }

  /**
   * The server has already deleted `cashFlow`. Its row and totals go at once,
   * so a failed reload afterwards cannot leave a deleted entry on screen with
   * a delete button that could only answer "not found"; the reload then
   * replaces the local arithmetic with the server's numbers.
   */
  const removeCashFlow = async (cashFlow: CashFlow) => {
    setSummary((current) => current && withoutCashFlow(current, cashFlow))
    if (shiftId === null) return
    const request = ++latestRequest.current
    try {
      const loaded = await shiftsApi.getShiftSummary(shiftId)
      if (request === latestRequest.current) setSummary(loaded)
    } catch {
      if (request === latestRequest.current) toast.error(id.loadFailed.shiftSummary)
    }
  }

  return { summary, isLoading, loadError, retry, removeCashFlow }
}
