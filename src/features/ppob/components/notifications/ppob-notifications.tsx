import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Bell,
  Info,
  CreditCard,
  CheckCheck,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { id as i18n } from "@/i18n/id"
import {
  usePpobNotifications,
  usePpobMarkAllRead,
  usePpobMarkNotificationRead,
} from "../../hooks"
import type { NotificationItem } from "../../types"

const ITEMS_PER_PAGE = 20

function getCategoryIcon(category: string) {
  switch (category.toUpperCase()) {
    case "TRANSAKSI":
      return <CreditCard className="h-4 w-4 text-blue-600" />
    default:
      return <Info className="h-4 w-4 text-amber-600" />
  }
}

function getCategoryStyle(category: string) {
  switch (category.toUpperCase()) {
    case "TRANSAKSI":
      return "border-blue-200 bg-blue-50 text-blue-700"
    default:
      return "border-amber-200 bg-amber-50 text-amber-700"
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-"
  try {
    const d = new Date(dateStr.replace(" ", "T"))
    return d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateStr
  }
}

function NotificationDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: NotificationItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getCategoryIcon(item.category)}
            {item.category}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {formatDate(item.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-2">
          {item.title && item.title !== item.category && (
            <p className="font-semibold">{item.title}</p>
          )}
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {item.message}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PpobNotifications() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch, isRefetching } = usePpobNotifications()
  const markAllRead = usePpobMarkAllRead()
  const markRead = usePpobMarkNotificationRead()

  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const items = data?.items ?? []
  const unreadCount = data?.unreadCount ?? 0

  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE))
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return items.slice(start, start + ITEMS_PER_PAGE)
  }, [items, currentPage])

  const handleItemClick = (item: NotificationItem) => {
    setSelectedItem(item)
    if (item.status === "unread") {
      markRead.mutate(
        { inboxId: item.inboxId },
        { onSuccess: () => refetch() }
      )
    }
  }

  const handleMarkAllRead = () => {
    markAllRead.mutate({}, { onSuccess: () => refetch() })
  }

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">{i18n.ppob.notifications}</h1>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="text-xs px-2">
              {unreadCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isPending}
            >
              {markAllRead.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="mr-2 h-4 w-4" />
              )}
              {i18n.ppob.markAllRead}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <Bell className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-destructive mb-3">Gagal memuat pemberitahuan</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <Bell className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">{i18n.ppob.noNotifications}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Notification List */}
          <div className="divide-y rounded-lg border bg-card">
            {paginatedItems.map((item, idx) => {
              const isUnread = item.status === "unread"
              return (
                <button
                  key={item.inboxId || idx}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/50 ${
                    isUnread ? "bg-card" : "bg-muted/20"
                  }`}
                  onClick={() => handleItemClick(item)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-xs font-bold ${getCategoryStyle(item.category)}`}>
                      {item.category}
                    </Badge>
                    {isUnread && (
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                    )}
                  </div>
                  <p className={`text-sm line-clamp-2 ${isUnread ? "font-medium" : "text-muted-foreground"}`}>
                    {item.message}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    {formatDate(item.createdAt)}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Halaman {currentPage} dari {totalPages} ({items.length} pemberitahuan)
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    // Show first, last, current, and neighbors
                    return page === 1 || page === totalPages ||
                      Math.abs(page - currentPage) <= 1
                  })
                  .reduce<(number | "ellipsis")[]>((acc, page, idx, arr) => {
                    if (idx > 0 && page - (arr[idx - 1] as number) > 1) {
                      acc.push("ellipsis")
                    }
                    acc.push(page)
                    return acc
                  }, [])
                  .map((item, idx) =>
                    item === "ellipsis" ? (
                      <span key={`e-${idx}`} className="px-1 text-muted-foreground">…</span>
                    ) : (
                      <Button
                        key={item}
                        variant={currentPage === item ? "default" : "outline"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setCurrentPage(item)}
                      >
                        {item}
                      </Button>
                    )
                  )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Dialog */}
      {selectedItem && (
        <NotificationDetailDialog
          item={selectedItem}
          open={!!selectedItem}
          onOpenChange={(open) => !open && setSelectedItem(null)}
        />
      )}
    </div>
  )
}
