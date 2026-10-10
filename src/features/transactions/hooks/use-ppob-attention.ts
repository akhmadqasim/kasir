import { useApiQuery } from "@/hooks/use-api"
import { queryKeys } from "@/lib/api/query-keys"
import { getPpobAttention, type PpobAttention } from "@/lib/api/transactions"

/**
 * How often the count is asked again while it is above zero: the background
 * reconcile settles lines and tells nobody. At zero it is not polled; a dialog
 * that sees a line turn uncertain invalidates the count, as do Cek status and
 * Tandai.
 */
export const PPOB_ATTENTION_POLL_MS = 60_000

/** PPOB lines still `uncertain`, on any day: 0 until the first answer. */
export function usePpobAttention(): number {
  const { data } = useApiQuery<PpobAttention>(
    queryKeys.transactions.ppobAttention,
    getPpobAttention,
    {
      refetchInterval: (query) =>
        (query.state.data?.uncertain ?? 0) > 0 ? PPOB_ATTENTION_POLL_MS : false,
      staleTime: PPOB_ATTENTION_POLL_MS / 2,
    },
  )
  return data?.uncertain ?? 0
}
