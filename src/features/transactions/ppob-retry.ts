import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { retryPpobFulfillment } from "@/lib/api/transactions"
import type { TransactionItem } from "./types"

export interface PpobRetryFailure {
  item: TransactionItem
  message: string
}

/**
 * Retry every given PPOB line with the same PIN and report the ones the server
 * refused.
 *
 * One cart can hold several failed PPOB purchases. Stopping at the first refusal
 * left every later line untried while the toast only named the first error, so
 * the cashier could not tell which purchases had gone back to the provider. A
 * refusal here is a validation error from claiming the line (the PIN itself is
 * only used by the background task), so trying the rest is always safe.
 */
export async function retryPpobLines(
  items: readonly TransactionItem[],
  pin: string,
): Promise<PpobRetryFailure[]> {
  const failures: PpobRetryFailure[] = []
  for (const item of items) {
    try {
      await retryPpobFulfillment(item.id, pin)
    } catch (e) {
      failures.push({ item, message: errorMessage(e) })
    }
  }
  return failures
}

/** Toast text for refused retries; names each line when there was more than one. */
export function ppobRetryFailureMessage(
  failures: readonly PpobRetryFailure[],
  attempted: number,
): string {
  if (attempted === 1 && failures.length === 1) {
    return id.ppobFulfillment.retryFailed(failures[0].message)
  }
  const details = failures.map(({ item, message }) => `${item.product_name}: ${message}`)
  return id.ppobFulfillment.retryPartlyFailed(failures.length, attempted, details.join("; "))
}

/** Toast text for the lines that did go back to the provider. */
export function ppobRetrySuccessMessage(succeeded: number): string {
  return id.ppobFulfillment.retryStarted(succeeded)
}
