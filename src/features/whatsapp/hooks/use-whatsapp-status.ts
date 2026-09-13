import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import type { ApiError } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import {
  disableWhatsapp,
  enableWhatsapp,
  getWhatsappStatus,
  logoutWhatsapp,
} from "@/lib/api/whatsapp"
import { toast } from "@/lib/toast"
import type { WhatsappState, WhatsappStatus } from "../types"

/** Polling while the sidecar is starting up or waiting on a QR scan. */
const BUSY_INTERVAL_MS = 2_000

/** Polling once connected (or off) — nothing changes on its own from here. */
const IDLE_INTERVAL_MS = 30_000

const BUSY_STATES: readonly WhatsappState[] = ["starting", "qr_pending"]

/**
 * The connection's state, kept fresh. One query for the whole app: the
 * settings tab and the "Kirim WhatsApp" buttons in the cashier and history
 * screens all read the same cache entry.
 */
export function useWhatsappStatus() {
  return useApiQuery<WhatsappStatus>(queryKeys.whatsapp.status, getWhatsappStatus, {
    refetchInterval: (query) => {
      const data = query.state.data
      // Never turned on: nothing changes without a person pressing "Aktifkan",
      // which already seeds this same cache entry on success — no need to poll
      // for a change that cannot happen on its own.
      if (!data?.enabled) return false
      return BUSY_STATES.includes(data.state) ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS
    },
    refetchOnWindowFocus: false,
  })
}

/**
 * `enable`/`disable`/`logout`. Each seeds the status cache with the answer so
 * the tab updates before the next poll, the same idiom `useUpdateActions` uses.
 */
export function useWhatsappActions() {
  const queryClient = useQueryClient()
  const seed = (status: WhatsappStatus) => queryClient.setQueryData(queryKeys.whatsapp.status, status)
  const onError = (error: ApiError) => toast.error(error.message)

  const enable = useApiMutation<WhatsappStatus>(enableWhatsapp, { onSuccess: seed, onError })
  const disable = useApiMutation<WhatsappStatus>(disableWhatsapp, { onSuccess: seed, onError })
  const logout = useApiMutation<void>(logoutWhatsapp, {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.status }),
    onError,
  })

  return { enable, disable, logout }
}
