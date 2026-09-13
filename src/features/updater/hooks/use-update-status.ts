import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
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
 * Errors are left to the caller: a failed explicit check is a toast, a failed
 * download is already in the status the server reports.
 */
export function useUpdateActions() {
  const queryClient = useQueryClient()
  const seed = (status: UpdateStatus) => queryClient.setQueryData(queryKeys.updates.status, status)

  const check = useApiMutation<UpdateStatus>(checkForUpdate, { onSuccess: seed })
  const download = useApiMutation<UpdateStatus>(downloadUpdate, { onSuccess: seed })
  const install = useApiMutation<UpdateStatus>(installUpdate, { onSuccess: seed })

  return { check, download, install }
}
