export interface NotificationItem {
  inboxId: string
  title: string
  message: string
  category: string
  status: "read" | "unread"
  createdAt: string | null
  rawData: Record<string, unknown>
}

export interface NotificationListResult {
  items: NotificationItem[]
  unreadCount: number
  totalCount: number
  currentPage: number
  totalPages: number
}
