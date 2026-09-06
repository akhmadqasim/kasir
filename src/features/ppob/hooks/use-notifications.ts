import { keepPreviousData } from "@tanstack/react-query"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import {
  getPpobNotifications,
  markAllPpobNotificationsRead,
  markPpobNotificationRead,
} from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import type { NotificationListResult } from "../types"

/**
 * The provider's inbox serves a five-minute server-side cache and only calls the
 * vendor again when `forceRefresh` is true, so a refresh button that omits it
 * re-renders the same list for five minutes.
 *
 * The flag is part of the query key: a forced read must not overwrite the cached
 * entry of a plain one, or the two would be indistinguishable in the cache.
 * Refetch on window focus is off for the same reason the cache exists — the
 * vendor call is expensive, and there is an explicit button for it.
 */
export function usePpobNotifications(
  page: number = 1,
  perPage: number = 20,
  forceRefresh: boolean = false
) {
  return useApiQuery<NotificationListResult>(
    queryKeys.ppob.notifications(page, perPage, forceRefresh),
    () => getPpobNotifications(page, perPage, forceRefresh),
    {
      placeholderData: keepPreviousData,
      staleTime: 30000,
      refetchOnWindowFocus: false,
      retry: false,
    }
  )
}

export function usePpobMarkAllRead() {
  return useApiMutation<void, void>(markAllPpobNotificationsRead)
}

export function usePpobMarkNotificationRead() {
  return useApiMutation<void, string>(markPpobNotificationRead)
}
