import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useSingleFlight } from "@/hooks/use-single-flight"
import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import { checkPpobStatus } from "@/lib/api/transactions"
import { toast } from "@/lib/toast"

/**
 * "Cek status" for an uncertain PPOB line: ask the server to look it up in the
 * Mitra history now. A settled line refreshes every transaction query, so the
 * badge, the retry/refund offers and the struk button follow at once.
 */
export function usePpobCheck() {
  const queryClient = useQueryClient()
  const { run } = useSingleFlight()
  // Which line the running check is for; `run` drops a second check meanwhile.
  const [checkingId, setCheckingId] = useState<number | null>(null)

  const check = (itemId: number) =>
    run(
      async () => {
        setCheckingId(itemId)
        try {
          const result = await checkPpobStatus(itemId)
          if (result.status === "success") toast.success(result.message)
          else toast.warning(result.message)
          if (result.status !== "uncertain") {
            await queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
          }
        } catch (e) {
          toast.error(id.ppobFulfillment.checkStatusFailed(errorMessage(e)))
          // The usual refusal is "only an uncertain line can be checked": the
          // background reconcile settled it after this screen loaded. Refetch, so
          // the stale Cek status / Tandai buttons go away instead of failing again.
          await queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
        } finally {
          setCheckingId(null)
        }
      },
      { quiet: true },
    )

  return { check, checkingId }
}
