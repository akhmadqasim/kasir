import { useState, useCallback } from "react"
import { Plus, Check, X, Trash2 } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "pending", label: "Menunggu" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
] as const

const REASON_OPTIONS = [
  { value: "all", label: "Semua Alasan" },
  { value: "damaged", label: "Rusak" },
  { value: "expired", label: "Kadaluarsa" },
  { value: "lost", label: "Hilang" },
  { value: "other", label: "Lainnya" },
] as const

const REASON_LABELS: Record<string, string> = {
  damaged: "Rusak",
  expired: "Kadaluarsa",
  lost: "Hilang",
  other: "Lainnya",
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
}

function ReasonBadge({ reason }: { reason: string }) {
  switch (reason) {
    case "damaged":
      return <Badge variant="destructive">Rusak</Badge>
    case "expired":
      return <StatusBadge status="warning">Kadaluarsa</StatusBadge>
    case "lost":
      return <Badge variant="outline">Hilang</Badge>
    default:
      return <Badge variant="secondary">{REASON_LABELS[reason] ?? reason}</Badge>
  }
}

function WriteoffStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <StatusBadge status="warning">Menunggu</StatusBadge>
    case "approved":
      return <StatusBadge status="success">Disetujui</StatusBadge>
    case "rejected":
      return <StatusBadge status="error">Ditolak</StatusBadge>
    default:
      return <Badge variant="secondary">{STATUS_LABELS[status] ?? status}</Badge>
  }
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
  const [statusFilter, setStatusFilter] = useState("all")
  const [reasonFilter, setReasonFilter] = useState("all")
  const [formOpen, setFormOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  // Data
  const { data, isLoading } = useListWriteoffs({
    page,
    perPage: 50,
    status: statusFilter === "all" ? undefined : statusFilter,
    reason: reasonFilter === "all" ? undefined : reasonFilter,
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
        approveWriteoff.mutate(
          { writeoffId: writeoff.id, callerId: user.id },
          { onSettled }
        )
        break
      case "reject":
        rejectWriteoff.mutate(
          { writeoffId: writeoff.id, callerId: user.id },
          { onSettled }
        )
        break
      case "delete":
        deleteWriteoff.mutate(
          { writeoffId: writeoff.id, callerId: user.id },
          { onSettled }
        )
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
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{id.nav.stock}</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Buat Write-off
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={reasonFilter} onValueChange={handleFilterChange(setReasonFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">{id.common.loading}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. WO</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead className="text-right">Nilai Kerugian</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {writeoffs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      Tidak ada data write-off
                    </TableCell>
                  </TableRow>
                ) : (
                  writeoffs.map((wo) => (
                    <TableRow key={wo.id}>
                      <TableCell className="font-mono text-sm">{wo.writeoffNumber}</TableCell>
                      <TableCell className="font-medium">{wo.productName}</TableCell>
                      <TableCell className="text-muted-foreground">{wo.cashierName}</TableCell>
                      <TableCell className="text-right">{wo.quantity}</TableCell>
                      <TableCell><ReasonBadge reason={wo.reason} /></TableCell>
                      <TableCell className="text-right font-medium text-destructive">
                        {formatRupiah(wo.lossValue)}
                      </TableCell>
                      <TableCell><WriteoffStatusBadge status={wo.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(wo.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <WriteoffActions
                          writeoff={wo}
                          isAdmin={isAdmin}
                          onAction={setConfirmAction}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">
                Halaman {data?.page ?? 1} dari {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Selanjutnya
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Form Dialog */}
      <WriteoffFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {/* Confirmation Dialog */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction ? confirmMessages[confirmAction.type].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction ? confirmMessages[confirmAction.type].description : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmAction && (
            <div className="rounded-md border bg-default/50 px-3 py-2 text-sm">
              <div><span className="text-muted-foreground">No. WO:</span> {confirmAction.writeoff.writeoffNumber}</div>
              <div><span className="text-muted-foreground">Produk:</span> {confirmAction.writeoff.productName}</div>
              <div><span className="text-muted-foreground">Qty:</span> {confirmAction.writeoff.quantity}</div>
              <div><span className="text-muted-foreground">Kerugian:</span> {formatRupiah(confirmAction.writeoff.lossValue)}</div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{id.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? id.common.loading : id.common.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    return <span className="text-sm text-muted-foreground">—</span>
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {isAdmin && (
        <>
          <Button
            variant="ghost"
            size="icon"
            title="Setujui"
            onClick={() => onAction({ type: "approve", writeoff })}
          >
            <Check className="h-4 w-4 text-green-600" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Tolak"
            onClick={() => onAction({ type: "reject", writeoff })}
          >
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </>
      )}
      {isAdmin && !writeoff.refundId && (
        <Button
          variant="ghost"
          size="icon"
          title="Hapus"
          onClick={() => onAction({ type: "delete", writeoff })}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  )
}
