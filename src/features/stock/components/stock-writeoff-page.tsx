import { useState, useCallback } from "react"
import { Plus, Check, X, Trash2 } from "lucide-react"
import { AlertDialog, Button, Label, ListBox, Select, Skeleton, Table } from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { StatusBadge, type StatusVariant } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { id } from "@/i18n/id"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import {
  useListWriteoffs,
  useApproveWriteoff,
  useRejectWriteoff,
  useDeleteWriteoff,
} from "../hooks/use-stock-writeoffs"
import { WriteoffFormDialog } from "./writeoff-form-dialog"
import type { StockWriteoff } from "../types"

const ALL = "all"

const STATUS_OPTIONS = [
  { key: ALL, label: "Semua Status" },
  { key: "pending", label: "Menunggu" },
  { key: "approved", label: "Disetujui" },
  { key: "rejected", label: "Ditolak" },
] as const

const REASON_OPTIONS = [
  { key: ALL, label: "Semua Alasan" },
  { key: "damaged", label: "Rusak" },
  { key: "expired", label: "Kadaluarsa" },
  { key: "lost", label: "Hilang" },
  { key: "other", label: "Lainnya" },
] as const

const REASON_LABELS: Record<string, string> = {
  damaged: "Rusak",
  expired: "Kadaluarsa",
  lost: "Hilang",
  other: "Lainnya",
}

/** Alasan kerugian: rusak paling berat, kadaluarsa masih bisa dicegah, hilang netral. */
const REASON_VARIANTS: Record<string, StatusVariant> = {
  damaged: "error",
  expired: "warning",
  lost: "neutral",
  other: "neutral",
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
}

const STATUS_VARIANTS: Record<string, StatusVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
}

const COLUMN_COUNT = 9

function ReasonBadge({ reason }: { reason: string }) {
  return (
    <StatusBadge status={REASON_VARIANTS[reason] ?? "neutral"}>
      {REASON_LABELS[reason] ?? reason}
    </StatusBadge>
  )
}

function WriteoffStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge status={STATUS_VARIANTS[status] ?? "neutral"}>
      {STATUS_LABELS[status] ?? status}
    </StatusBadge>
  )
}

type ConfirmAction = {
  type: "approve" | "reject" | "delete"
  writeoff: StockWriteoff
}

export function StockWriteoffPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"

  // Filters & pagination
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [reasonFilter, setReasonFilter] = useState(ALL)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  // Data
  const { data, isLoading } = useListWriteoffs({
    page,
    perPage: 50,
    status: statusFilter === ALL ? undefined : statusFilter,
    reason: reasonFilter === ALL ? undefined : reasonFilter,
  })

  // Mutations
  const approveWriteoff = useApproveWriteoff()
  const rejectWriteoff = useRejectWriteoff()
  const deleteWriteoff = useDeleteWriteoff()

  const handleFilterChange = useCallback((setter: (v: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }, [])

  const handleConfirm = () => {
    if (!confirmAction || !user) return
    const { type, writeoff } = confirmAction

    const onSettled = () => setConfirmAction(null)

    switch (type) {
      case "approve":
        approveWriteoff.mutate(writeoff.id, { onSettled })
        break
      case "reject":
        rejectWriteoff.mutate(writeoff.id, { onSettled })
        break
      case "delete":
        deleteWriteoff.mutate(writeoff.id, { onSettled })
        break
    }
  }

  const writeoffs = data?.items ?? []
  const totalPages = data?.totalPages ?? 1

  // Stock moves when a write-off is *created*, not when it is approved:
  // `create_stock_writeoff` decrements it in the same transaction as the insert,
  // `approve_stock_writeoff` only flips the status, and `reject`/`delete` put the
  // stock back — except for refund-originated rows, which never deducted any.
  const isFromRefund = confirmAction?.writeoff.refundId != null
  const confirmMessages: Record<string, { title: string; description: string }> = {
    approve: {
      title: "Setujui Write-off",
      description:
        "Stok sudah dikurangi sejak write-off ini dibuat. Menyetujui hanya mengesahkan kerugiannya, stok tidak berubah lagi.",
    },
    reject: {
      title: "Tolak Write-off",
      description: isFromRefund
        ? "Write-off ini berasal dari refund, jadi stoknya tidak pernah dikurangi dan tidak akan dikembalikan. Kerugiannya dibatalkan."
        : "Stok yang dikurangi saat write-off ini dibuat akan dikembalikan.",
    },
    delete: {
      title: "Hapus Write-off",
      description:
        "Data write-off dihapus permanen dan stok yang dikurangi saat pembuatan dikembalikan.",
    },
  }

  const isPending = approveWriteoff.isPending || rejectWriteoff.isPending || deleteWriteoff.isPending

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{id.nav.stock}</h1>
        <Button onPress={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Buat Write-off
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <Select
          aria-label="Filter status"
          className="w-44"
          value={statusFilter}
          onChange={(value) => handleFilterChange(setStatusFilter)(String(value))}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {STATUS_OPTIONS.map((option) => (
                <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Select
          aria-label="Filter alasan"
          className="w-44"
          value={reasonFilter}
          onChange={(value) => handleFilterChange(setReasonFilter)(String(value))}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {REASON_OPTIONS.map((option) => (
                <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label={id.nav.stock}>
              <Table.Header>
                <Table.Column isRowHeader>No. WO</Table.Column>
                <Table.Column>Produk</Table.Column>
                <Table.Column>Kasir</Table.Column>
                <Table.Column className="text-right">Qty</Table.Column>
                <Table.Column>Alasan</Table.Column>
                <Table.Column className="text-right">Nilai Kerugian</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Tanggal</Table.Column>
                <Table.Column className="text-right">Aksi</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <p className="py-10 text-center text-muted">Tidak ada data write-off</p>
                )}
              >
                {isLoading
                  ? Array.from({ length: 5 }).map((_, rowIndex) => (
                      <Table.Row key={`skeleton-${rowIndex}`} id={`skeleton-${rowIndex}`}>
                        {Array.from({ length: COLUMN_COUNT }).map((_, cellIndex) => (
                          <Table.Cell key={cellIndex}>
                            <Skeleton className="h-5 w-full" />
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))
                  : writeoffs.map((wo) => (
                      <Table.Row key={wo.id} id={wo.id} textValue={wo.writeoffNumber}>
                        <Table.Cell className="font-mono text-sm">{wo.writeoffNumber}</Table.Cell>
                        <Table.Cell className="font-medium">{wo.productName}</Table.Cell>
                        <Table.Cell className="text-muted">{wo.cashierName}</Table.Cell>
                        <Table.Cell className="text-right">{wo.quantity}</Table.Cell>
                        <Table.Cell><ReasonBadge reason={wo.reason} /></Table.Cell>
                        <Table.Cell className="text-right font-medium text-danger">
                          {formatRupiah(wo.lossValue)}
                        </Table.Cell>
                        <Table.Cell><WriteoffStatusBadge status={wo.status} /></Table.Cell>
                        <Table.Cell className="text-sm text-muted">
                          {formatDateTime(wo.createdAt)}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <WriteoffActions
                            writeoff={wo}
                            isAdmin={isAdmin}
                            onAction={setConfirmAction}
                          />
                        </Table.Cell>
                      </Table.Row>
                    ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Form Dialog */}
      <WriteoffFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {/* Confirmation Dialog */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog
            aria-label={confirmAction ? confirmMessages[confirmAction.type].title : "Konfirmasi"}
          >
            <AlertDialog.Header>
              <AlertDialog.Icon status={confirmAction?.type === "approve" ? "warning" : "danger"} />
              <AlertDialog.Heading>
                {confirmAction ? confirmMessages[confirmAction.type].title : ""}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm text-muted">
                {confirmAction ? confirmMessages[confirmAction.type].description : ""}
              </p>
              {confirmAction && (
                <div className="rounded-md border bg-default/50 px-3 py-2 text-sm">
                  <div><span className="text-muted">No. WO:</span> {confirmAction.writeoff.writeoffNumber}</div>
                  <div><span className="text-muted">Produk:</span> {confirmAction.writeoff.productName}</div>
                  <div><span className="text-muted">Qty:</span> {confirmAction.writeoff.quantity}</div>
                  <div><span className="text-muted">Kerugian:</span> {formatRupiah(confirmAction.writeoff.lossValue)}</div>
                </div>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isPending}
                variant="outline"
                onPress={() => setConfirmAction(null)}
              >
                {id.common.cancel}
              </Button>
              <Button isDisabled={isPending} onPress={handleConfirm}>
                {isPending ? id.common.loading : id.common.confirm}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}

function WriteoffActions({
  writeoff,
  isAdmin,
  onAction,
}: {
  writeoff: StockWriteoff
  isAdmin: boolean
  onAction: (action: ConfirmAction) => void
}) {
  if (writeoff.status !== "pending") {
    return <span className="text-sm text-muted">—</span>
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {isAdmin && (
        <>
          <Button
            aria-label="Setujui"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => onAction({ type: "approve", writeoff })}
          >
            <Check className="h-4 w-4 text-success" />
          </Button>
          <Button
            aria-label="Tolak"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => onAction({ type: "reject", writeoff })}
          >
            <X className="h-4 w-4 text-danger" />
          </Button>
        </>
      )}
      {isAdmin && !writeoff.refundId && (
        <Button
          aria-label="Hapus"
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={() => onAction({ type: "delete", writeoff })}
        >
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      )}
    </div>
  )
}
