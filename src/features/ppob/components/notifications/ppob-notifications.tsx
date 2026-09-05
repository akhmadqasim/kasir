import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Modal, Pagination, Separator, Skeleton } from "@heroui/react"
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Bell,
  Info,
  CreditCard,
  CheckCheck,
} from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { id as i18n } from "@/i18n/id"
import {
  usePpobNotifications,
  usePpobMarkAllRead,
  usePpobMarkNotificationRead,
} from "../../hooks"
import type { NotificationItem } from "../../types"

const ITEMS_PER_PAGE = 20

function CategoryIcon({ category }: { category: string }) {
  return category.toUpperCase() === "TRANSAKSI" ? (
    <CreditCard className="h-4 w-4 text-accent" />
  ) : (
    <Info className="h-4 w-4 text-warning" />
  )
}

/** Transaksi dan pengumuman dibedakan warnanya, bukan cuma teksnya. */
function CategoryBadge({ category }: { category: string }) {
  return (
    <StatusBadge
      size="sm"
      status={category.toUpperCase() === "TRANSAKSI" ? "info" : "warning"}
    >
      {category}
    </StatusBadge>
  )
}

/** Halaman pertama, terakhir, halaman aktif dan tetangganya; sisanya jadi elipsis. */
function getPageNumbers(page: number, totalPages: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = []

  for (let candidate = 1; candidate <= totalPages; candidate++) {
    const isEdge = candidate === 1 || candidate === totalPages
    if (!isEdge && Math.abs(candidate - page) > 1) continue
    const previous = pages[pages.length - 1]
    if (typeof previous === "number" && candidate - previous > 1) {
      pages.push("ellipsis")
    }
    pages.push(candidate)
  }

  return pages
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
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={item.category}>
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              <CategoryIcon category={item.category} />
              {item.category}
            </Modal.Heading>
            <Modal.CloseTrigger />
          </Modal.Header>

          <Modal.Body className="space-y-3">
            <p className="text-xs text-muted">{formatDate(item.createdAt)}</p>

            <Separator />

            {item.title && item.title !== item.category && (
              <p className="text-sm font-semibold">{item.title}</p>
            )}
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.message}</p>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

export function PpobNotifications() {
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState(1)
  // Set once the cashier presses refresh, so from then on this screen reads past
  // the backend's five-minute cache. It is component state, so leaving the screen
  // drops it back to the cheap cached read.
  const [forceRefresh, setForceRefresh] = useState(false)
  const { data, isLoading, error, refetch, isRefetching } = usePpobNotifications(
    currentPage,
    ITEMS_PER_PAGE,
    forceRefresh
  )
  const markAllRead = usePpobMarkAllRead()
  const markRead = usePpobMarkNotificationRead()

  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null)

  const items = data?.items ?? []
  const unreadCount = data?.unreadCount ?? 0
  const totalPages = data?.totalPages ?? 1
  const totalCount = data?.totalCount ?? 0

  const handleItemPress = (item: NotificationItem) => {
    setSelectedItem(item)
    if (item.status === "unread") {
      markRead.mutate({ inboxId: item.inboxId }, { onSuccess: () => refetch() })
    }
  }

  const handleMarkAllRead = () => {
    markAllRead.mutate({}, { onSuccess: () => refetch() })
  }

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            aria-label={i18n.common.back}
            isIconOnly
            variant="ghost"
            onPress={() => navigate("/ppob")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{i18n.ppob.notifications}</h1>
          {unreadCount > 0 && (
            <StatusBadge size="sm" status="error">
              {unreadCount}
            </StatusBadge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              isDisabled={markAllRead.isPending}
              size="sm"
              variant="outline"
              onPress={handleMarkAllRead}
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
            aria-label="Muat ulang dari Mitra"
            isDisabled={isRefetching}
            isIconOnly
            variant="outline"
            onPress={() => {
              // The first press switches to the forced key, which fetches on its
              // own; later presses are plain refetches of that same forced key.
              if (forceRefresh) {
                refetch()
              } else {
                setForceRefresh(true)
              }
            }}
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bell className="mb-3 h-10 w-10 text-muted" />
          <p className="mb-1 font-medium text-danger">Gagal memuat pemberitahuan</p>
          <p className="text-sm text-muted">Silakan coba lagi nanti</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bell className="mb-3 h-10 w-10 text-muted" />
          <p className="mb-1 font-medium">{i18n.ppob.noNotifications}</p>
          <p className="text-sm text-muted">Belum ada pemberitahuan saat ini</p>
        </div>
      ) : (
        <>
          {/* Notification List */}
          <div className="space-y-2">
            {items.map((item, idx) => {
              const isUnread = item.status === "unread"
              return (
                <Button
                  key={item.inboxId || idx}
                  className={`h-auto w-full flex-col items-start gap-1 p-3 text-left ${
                    isUnread ? "" : "bg-default/20"
                  }`}
                  variant="outline"
                  onPress={() => handleItemPress(item)}
                >
                  <span className="flex items-center gap-2">
                    <CategoryBadge category={item.category} />
                    {isUnread && <span className="h-2 w-2 rounded-full bg-danger" />}
                  </span>
                  <span
                    className={`line-clamp-2 text-sm ${
                      isUnread ? "font-medium" : "text-muted"
                    }`}
                  >
                    {item.message}
                  </span>
                  <span className="text-xs text-muted">{formatDate(item.createdAt)}</span>
                </Button>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination className="pt-2" size="sm">
              <Pagination.Summary>
                Halaman {currentPage} dari {totalPages} ({totalCount} pemberitahuan)
              </Pagination.Summary>
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={currentPage <= 1}
                    onPress={() => setCurrentPage((page) => page - 1)}
                  >
                    <Pagination.PreviousIcon />
                  </Pagination.Previous>
                </Pagination.Item>
                {getPageNumbers(currentPage, totalPages).map((page, index) =>
                  page === "ellipsis" ? (
                    <Pagination.Item key={`ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={page}>
                      <Pagination.Link
                        isActive={page === currentPage}
                        onPress={() => setCurrentPage(page)}
                      >
                        {page}
                      </Pagination.Link>
                    </Pagination.Item>
                  )
                )}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={currentPage >= totalPages}
                    onPress={() => setCurrentPage((page) => page + 1)}
                  >
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
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
