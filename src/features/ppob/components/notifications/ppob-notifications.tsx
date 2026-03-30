import { useState } from "react"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
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

function getCategoryIcon(category: string) {
  switch (category.toUpperCase()) {
    case "TRANSAKSI":
      return <CreditCard className="h-5 w-5 text-blue-600" />
    case "INFORMASI":
    default:
      return <Info className="h-5 w-5 text-amber-600" />
  }
}

function getCategoryColor(category: string) {
  switch (category.toUpperCase()) {
    case "TRANSAKSI":
      return "border-blue-200 bg-blue-50 text-blue-700"
    case "INFORMASI":
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

        <div className="space-y-3">
          {item.title && item.title !== item.category && (
            <h3 className="font-semibold text-base">{item.title}</h3>
          )}

          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {item.message}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NotificationCard({
  item,
  onClick,
}: {
  item: NotificationItem
  onClick: () => void
}) {
  const isUnread = item.status === "unread"

  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-accent/50 ${
        isUnread ? "border-l-4 border-l-blue-500" : "opacity-75"
      }`}
      onClick={onClick}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          {getCategoryIcon(item.category)}
          <CardTitle className="text-sm">
            <Badge variant="outline" className={getCategoryColor(item.category)}>
              {item.category}
            </Badge>
          </CardTitle>
          {isUnread && (
            <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3 pt-0 px-4 pl-[52px]">
        <CardDescription className="text-foreground line-clamp-2 text-sm">
          {item.message}
        </CardDescription>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
          <Clock className="h-3 w-3" />
          {formatDate(item.createdAt)}
        </p>
      </CardContent>
    </Card>
  )
}

export function PpobNotifications() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch, isRefetching } = usePpobNotifications()
  const markAllRead = usePpobMarkAllRead()
  const markRead = usePpobMarkNotificationRead()

  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null)

  const items = data?.items ?? []
  const unreadCount = data?.unreadCount ?? 0

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
    markAllRead.mutate(
      {},
      { onSuccess: () => refetch() }
    )
  }

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{i18n.ppob.notifications}</h1>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unreadCount}
              </Badge>
            )}
          </div>
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
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <Card className="py-16">
          <CardContent className="flex flex-col items-center justify-center text-center">
            <Bell className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-destructive mb-2">Gagal memuat pemberitahuan</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="py-16">
          <CardContent className="flex flex-col items-center justify-center text-center">
            <Bell className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">{i18n.ppob.noNotifications}</p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-140px)]">
          <div className="space-y-2 pr-4">
            {items.map((item, idx) => (
              <NotificationCard
                key={item.inboxId || idx}
                item={item}
                onClick={() => handleItemClick(item)}
              />
            ))}
          </div>
        </ScrollArea>
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
