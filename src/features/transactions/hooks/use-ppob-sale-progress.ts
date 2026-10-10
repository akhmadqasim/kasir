import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useApiQuery } from "@/hooks/use-api"
import { queryKeys } from "@/lib/api/query-keys"
import { getTransactionDetail } from "@/lib/api/transactions"
import {
  hasPpobLineInFlight,
  isPpobUncertain,
  ppobLines,
  ppobSalePollInterval,
} from "@/lib/ppob-status"
import type { Transaction, TransactionDetail, TransactionItem } from "../types"

/** What checkout answered: the sale and its lines, before the provider did. */
interface CheckoutResult {
  transaction: Pick<Transaction, "id">
  items: TransactionItem[]
}

/**
 * The PPOB lines of a sale just rung up, as they settle. Checkout answers
 * before the provider, so the detail is polled while a line is pending or
 * processing. A sale with no PPOB line asks nothing.
 *
 * - `inFlight`: a provider call has not answered yet; before the first detail
 *   the checkout result is all there is, and it counts as in flight.
 * - `uncertain`: nothing is in flight and some line is uncertain. That also
 *   refreshes the attention count, since this screen is the first to see it.
 */
export function usePpobSaleProgress(result: CheckoutResult) {
  const queryClient = useQueryClient()
  const hasPpob = ppobLines(result.items).length > 0
  const detail = useApiQuery<TransactionDetail>(
    queryKeys.transactions.detail(result.transaction.id),
    () => getTransactionDetail(result.transaction.id),
    {
      enabled: hasPpob,
      refetchInterval: (query) =>
        ppobSalePollInterval(ppobLines(query.state.data?.items ?? result.items)),
    },
  )

  const lines: TransactionItem[] = ppobLines(detail.data?.items ?? result.items)
  const inFlight = hasPpob && (detail.data === undefined || hasPpobLineInFlight(lines))
  const uncertain = !inFlight && lines.some((line) => isPpobUncertain(line.ppob_status))

  useEffect(() => {
    if (!uncertain) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.ppobAttention })
  }, [uncertain, queryClient])

  return { lines, inFlight, uncertain }
}
