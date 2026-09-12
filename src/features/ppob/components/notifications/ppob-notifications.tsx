import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Badge, Button, Modal, Pagination, Skeleton, Spinner } from "@heroui/react"
import { RefreshCw, Bell, Info, CreditCard, CheckCheck } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { id as i18n } from "@/i18n/id"
import { usePpobNotifications, usePpobMarkAllRead, usePpobMarkNotificationRead } from "../../hooks"
import type { NotificationItem } from "../../types"

const ITEMS_PER_PAGE = 20

/** Only drawn inside `Modal.Icon`, whose 40px circle expects a 20px glyph. */
function CategoryIcon({ category }: { category: string }) {
  return category.toUpperCase() === "TRANSAKSI" ? (
    <CreditCard className="size-5 text-accent" />
  ) : (
    <Info className="size-5 text-warning" />
  )
}

/** Transaksi dan pengumuman dibedakan warnanya, bukan cuma teksnya. */
function CategoryBadge({ category }: { category: string }) {
  return (
    <StatusBadge size="sm" status={category.toUpperCase() === "TRANSAKSI" ? "info" : "warning"}>
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
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-default text-foreground">
              <CategoryIcon category={item.category} />
            </Modal.Icon>
            <Modal.Heading>{item.category}</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <p>{formatDate(item.createdAt)}</p>
            {item.title && item.title !== item.category && (
              <p className="font-semibold">{item.title}</p>
            )}
            <p className="whitespace-pre-wrap">{item.message}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Tutup
            </Button>
          </Modal.Footer>
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
    forceRefresh,
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
      markRead.mutate(item.inboxId, { onSuccess: () => refetch() })
    }
  }

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, { onSuccess: () => refetch() })
  }

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader
        actions={
          <>
            {unreadCount > 0 && (
              <StatusBadge size="sm" status="error">
                {unreadCount}
              </StatusBadge>
            )}
            {unreadCount > 0 && (
              <PendingButton
                isPending={markAllRead.isPending}
                size="sm"
                variant="secondary"
                onPress={handleMarkAllRead}
              >
                <CheckCheck />
                {i18n.ppob.markAllRead}
              </PendingButton>
            )}
            <Button
              aria-label="Muat ulang dari Mitra"
              isIconOnly
              isPending={isRefetching}
              size="sm"
              variant="tertiary"
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
              {({ isPending }) =>
                isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />
              }
            </Button>
          </>
        }
        title={i18n.ppob.notifications}
        onBack={() => navigate("/ppob")}
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <NoData icon={<Bell />} title="Gagal memuat pemberitahuan" tone="danger">
          Silakan coba lagi nanti
        </NoData>
      ) : items.length === 0 ? (
        <NoData icon={<Bell />} title={i18n.ppob.noNotifications}>
          Belum ada pemberitahuan saat ini
        </NoData>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((item, idx) => {
              const isUnread = item.status === "unread"
              return (
                <Button
                  key={item.inboxId || idx}
                  fullWidth
                  className={`h-auto flex-col items-start gap-1 p-3 text-left ${
                    isUnread ? "" : "bg-default/20"
                  }`}
                  variant="secondary"
                  onPress={() => handleItemPress(item)}
                >
                  {/* Titik belum-dibaca ditempel ke label kategorinya. */}
                  {isUnread ? (
                    <Badge.Anchor>
                      <CategoryBadge category={item.category} />
                      <Badge aria-label="Belum dibaca" color="danger" size="sm" />
                    </Badge.Anchor>
                  ) : (
                    <CategoryBadge category={item.category} />
                  )}
                  <span
                    className={`line-clamp-2 text-sm ${isUnread ? "font-medium" : "text-muted"}`}
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
                  ),
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
