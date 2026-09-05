import { keepPreviousData } from "@tanstack/react-query"
import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type { NotificationListResult } from "../types"

/**
 * `ppob_get_notifications` serves a five-minute process cache and only calls the
 * vendor again when `forceRefresh` is true, so a refresh button that omits it
 * re-renders the same list for five minutes.
 *
 * The flag is part of the query args, which is what `useTauriQuery` builds the
 * key from: a forced read must not overwrite the cached entry of a plain one, or
 * the two would be indistinguishable in the cache. Automatic refetch on window
 * focus is off for the same reason the cache exists — the vendor call is
 * expensive, and there is an explicit button for it.
 */
export function usePpobNotifications(
  page: number = 1,
  perPage: number = 20,
  forceRefresh: boolean = false
) {
  return useTauriQuery<NotificationListResult>(
    "ppob_get_notifications",
    { page, perPage, forceRefresh },
    {
      placeholderData: keepPreviousData,
      staleTime: 30000,
      refetchOnWindowFocus: false,
      retry: false,
    }
  )
}

export function usePpobMarkAllRead() {
  return useTauriMutation<void, Record<string, never>>(
    "ppob_mark_all_read"
  )
}

export function usePpobMarkNotificationRead() {
  return useTauriMutation<void, { inboxId: string }>(
    "ppob_mark_notification_read"
  )
}
