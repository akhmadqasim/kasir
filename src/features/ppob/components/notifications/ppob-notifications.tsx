import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Badge, Button, Card, Modal, Skeleton, Spinner } from "@heroui/react"
import { cardVariants } from "@heroui/styles"
import { RefreshCw, Bell, Info, CreditCard, CheckCheck } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { id as i18n } from "@/i18n/id"
import { cn } from "@/lib/utils"
import { usePpobNotifications, usePpobMarkAllRead, usePpobMarkNotificationRead } from "../../hooks"
import type { NotificationItem } from "../../types"

const ITEMS_PER_PAGE = 20

const isTransaction = (category: string) => category.toUpperCase() === "TRANSAKSI"

/** `inboxId` pernah datang kosong dari vendor; indeksnya jadi cadangan kunci. */
const rowId = (item: NotificationItem, idx: number) => item.inboxId || `notif-${idx}`

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

/**
 * One notification as a pressable card, after the docs' notification card:
 * a tinted icon on the left, the category as a small uppercase label, the
 * message as the title, the date underneath. Unread ones sit on the stronger
 * surface with a dot on the icon; read ones fade to the default surface.
 *
 * The card element is a `button` styled with `cardVariants` — the docs'
 * pattern for an interactive card — so it is one tab stop that Enter and
 * Space open, without a ListBox wrapped around it.
 */
function NotificationCard({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  const unread = item.status === "unread"
  const transaction = isTransaction(item.category)
  const Icon = transaction ? CreditCard : Info

  const icon = (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        transaction
          ? "bg-accent-soft text-accent-soft-foreground"
          : "bg-warning-soft text-warning-soft-foreground",
      )}
    >
      <Icon className="size-5" />
    </span>
  )

  return (
    <button
      className={cn(
        cardVariants({ variant: unread ? "secondary" : "default" }).base(),
        "w-full cursor-pointer text-left transition-colors outline-none",
        "hover:bg-surface-tertiary focus-visible:ring-2 focus-visible:ring-focus",
      )}
      type="button"
      onClick={onPress}
    >
      <Card.Header className="flex-row items-start gap-3">
        {unread ? (
          <Badge.Anchor>
            {icon}
            <Badge aria-label="Belum dibaca" color="danger" size="sm" />
          </Badge.Anchor>
        ) : (
          icon
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted uppercase">{item.category}</span>
          <Card.Title className={cn("line-clamp-2 text-sm", !unread && "font-normal text-muted")}>
            {item.title && item.title !== item.category ? item.title : item.message}
          </Card.Title>
          {item.title && item.title !== item.category && (
            <Card.Description className="line-clamp-2 text-xs">{item.message}</Card.Description>
          )}
          <Card.Description className="text-xs">{formatDate(item.createdAt)}</Card.Description>
        </div>
      </Card.Header>
    </button>
  )
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
    // Centred and no wider than a reading column: each card is one message,
    // and a message stretched across a wide monitor is mostly empty card.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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
            <Skeleton key={i} className="h-24 w-full rounded-3xl" />
          ))}
        </div>
      ) : error ? (
        <NoData icon={<Bell />} title="Gagal memuat informasi" tone="danger">
          Silakan coba lagi nanti
        </NoData>
      ) : items.length === 0 ? (
        <NoData icon={<Bell />} title={i18n.ppob.noNotifications}>
          Belum ada informasi dari Mitra saat ini
        </NoData>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {items.map((item, idx) => (
              <NotificationCard
                key={rowId(item, idx)}
                item={item}
                onPress={() => handleItemPress(item)}
              />
            ))}
          </div>

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
