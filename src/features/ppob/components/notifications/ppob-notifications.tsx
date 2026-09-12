import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Badge,
  Button,
  Description,
  Label,
  ListBox,
  Modal,
  Skeleton,
  Spinner,
  Surface,
} from "@heroui/react"
import { RefreshCw, Bell, Info, CreditCard, CheckCheck } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { id as i18n } from "@/i18n/id"
import { usePpobNotifications, usePpobMarkAllRead, usePpobMarkNotificationRead } from "../../hooks"
import type { NotificationItem } from "../../types"

const ITEMS_PER_PAGE = 20

const isTransaction = (category: string) => category.toUpperCase() === "TRANSAKSI"

/** `inboxId` pernah datang kosong dari vendor; indeksnya jadi cadangan kunci. */
const rowId = (item: NotificationItem, idx: number) => item.inboxId || `notif-${idx}`

/** Transaksi dan pengumuman dibedakan warnanya, bukan cuma teksnya. */
function CategoryBadge({ category }: { category: string }) {
  return (
    <StatusBadge size="sm" status={isTransaction(category) ? "info" : "warning"}>
      {category}
    </StatusBadge>
  )
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
            {/* Warna ikon mengikuti `CategoryBadge`: info untuk transaksi,
                warning untuk pengumuman (DESIGN.md §5.7). */}
            <Modal.Icon
              className={
                isTransaction(item.category)
                  ? "bg-accent-soft text-accent-soft-foreground"
                  : "bg-warning-soft text-warning-soft-foreground"
              }
            >
              {isTransaction(item.category) ? (
                <CreditCard className="size-5" />
              ) : (
                <Info className="size-5" />
              )}
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
          {/* Daftar aksi seperti contoh "With Sections" ListBox: `Surface`
              membingkainya, `onAction` membuka rinciannya. */}
          <Surface>
            <ListBox
              aria-label={i18n.ppob.notifications}
              className="p-2"
              selectionMode="none"
              onAction={(key) => {
                const item = items.find((candidate, idx) => rowId(candidate, idx) === key)
                if (item) handleItemPress(item)
              }}
            >
              {items.map((item, idx) => {
                const isUnread = item.status === "unread"
                return (
                  <ListBox.Item
                    key={rowId(item, idx)}
                    id={rowId(item, idx)}
                    textValue={item.message}
                  >
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      {/* Titik belum-dibaca ditempel ke label kategorinya. */}
                      {isUnread ? (
                        <Badge.Anchor>
                          <CategoryBadge category={item.category} />
                          <Badge aria-label="Belum dibaca" color="danger" size="sm" />
                        </Badge.Anchor>
                      ) : (
                        <CategoryBadge category={item.category} />
                      )}
                      <Label className={isUnread ? "line-clamp-2" : "line-clamp-2 text-muted"}>
                        {item.message}
                      </Label>
                      <Description>{formatDate(item.createdAt)}</Description>
                    </div>
                  </ListBox.Item>
                )
              })}
            </ListBox>
          </Surface>

          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
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
