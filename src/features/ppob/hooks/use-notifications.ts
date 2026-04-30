import { keepPreviousData } from "@tanstack/react-query"
import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type { NotificationListResult } from "../types"

export function usePpobNotifications(page: number = 1, perPage: number = 20) {
  return useTauriQuery<NotificationListResult>(
    "ppob_get_notifications",
    { page, perPage },
    {
      placeholderData: keepPreviousData,
      staleTime: 30000,
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
