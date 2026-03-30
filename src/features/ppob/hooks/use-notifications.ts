import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type { NotificationListResult } from "../types"

export function usePpobNotifications() {
  return useTauriQuery<NotificationListResult>(
    "ppob_get_notifications",
    {},
    {
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
