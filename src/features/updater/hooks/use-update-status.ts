import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { toast } from "@/lib/toast"
import type { ApiError } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import { checkForUpdate, downloadUpdate, getUpdateStatus, installUpdate } from "@/lib/api/updates"
import type { UpdatePhase, UpdateStatus } from "../types"

/** Polling while the server is doing something on our behalf. */
const BUSY_INTERVAL_MS = 1_000

/**
 * Polling otherwise. The server re-checks GitHub every six hours on its own;
 * this only has to notice that it did.
 */
const IDLE_INTERVAL_MS = 15 * 60_000

const BUSY_PHASES: readonly UpdatePhase[] = ["checking", "downloading", "installing"]

export function isBusyPhase(phase: UpdatePhase | undefined): boolean {
  return phase !== undefined && BUSY_PHASES.includes(phase)
}

/**
 * The updater's state, kept fresh.
 *
 * One query for the whole app: the banner in the layout and the card in
 * Pengaturan read the same cache entry, so a download started from one shows
 * its progress in the other. Polling speeds up while something is in flight
 * and drops to a slow tick otherwise.
 *
 * `retry: false` and no focus refetch: during an install the server goes away
 * on purpose, and the last status ("Memasang…") is exactly what should stay on
 * screen until the window closes. TanStack keeps `data` through a failed
 * refetch, so nothing has to be cached by hand.
 */
export function useUpdateStatus() {
  return useApiQuery<UpdateStatus>(queryKeys.updates.status, getUpdateStatus, {
    refetchInterval: (query) =>
      isBusyPhase(query.state.data?.phase) ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

/**
 * The three writes. Each answers with the status it moved to, which is written
 * straight into the query cache so the screen updates before the next poll.
 *
 * Every one of them is something a person pressed a button for, so a refusal
 * — a 422 because a background check just emptied the release, a 403, the LAN
 * dropping — is a toast rather than a spinner that stops for no reason.
 */
export function useUpdateActions() {
  const queryClient = useQueryClient()
  const seed = (status: UpdateStatus) => queryClient.setQueryData(queryKeys.updates.status, status)

  const options = { onSuccess: seed, onError: (error: ApiError) => toast.error(error.message) }

  const check = useApiMutation<UpdateStatus>(checkForUpdate, options)
  const download = useApiMutation<UpdateStatus>(downloadUpdate, options)
  const install = useApiMutation<UpdateStatus>(installUpdate, options)

  return { check, download, install }
}
