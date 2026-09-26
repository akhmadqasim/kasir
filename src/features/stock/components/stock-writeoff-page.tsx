import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@heroui/react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { LoadError } from "@/components/load-error"
import { OptionSelect } from "@/components/option-select"
import { TablePagination } from "@/components/table-pagination"
import { formatNumber } from "@/lib/format"
import { useAuthStore } from "@/features/auth"
import { id } from "@/i18n/id"
import {
  useListWriteoffs,
  useApproveWriteoff,
  useRejectWriteoff,
  useDeleteWriteoff,
} from "../hooks/use-stock-writeoffs"
import { WRITEOFF_REASON_OPTIONS, WRITEOFF_STATUS_OPTIONS } from "../labels"
import { WriteoffConfirmDialog, type WriteoffAction } from "./writeoff-confirm-dialog"
import { WriteoffFormDialog } from "./writeoff-form-dialog"
import { WriteoffTable } from "./writeoff-table"

const ALL = "all"

const STATUS_OPTIONS = [{ key: ALL, label: "Semua Status" }, ...WRITEOFF_STATUS_OPTIONS]

const REASON_OPTIONS = [{ key: ALL, label: "Semua Alasan" }, ...WRITEOFF_REASON_OPTIONS]

export function StockWriteoffPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")

  // Filters & pagination
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [reasonFilter, setReasonFilter] = useState(ALL)
  const [formOpen, setFormOpen] = useState(false)
  // Aksi dan keadaan buka dipisah: aksinya tetap terisi selama animasi tutup,
  // jadi judul dan ringkasan dialog tidak mengosong sesaat sebelum hilang.
  const [confirmAction, setConfirmAction] = useState<WriteoffAction | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Data
  const { data, isLoading, isPlaceholderData, isFetching, error, refetch } = useListWriteoffs({
    page,
    perPage: 50,
    status: statusFilter === ALL ? undefined : statusFilter,
    reason: reasonFilter === ALL ? undefined : reasonFilter,
  })

  // Menyetujui atau menolak di bawah filter "Menunggu" bisa mengosongkan
  // halaman terakhir. Tanpa ini halaman itu tampil kosong, dan kalau tinggal
  // satu halaman navigasinya ikut hilang — tidak ada jalan kembali.
  const lastPage = data && !isPlaceholderData ? Math.max(1, data.totalPages) : null
  if (lastPage != null && page > lastPage) setPage(lastPage)

  // Mutations
  const approveWriteoff = useApproveWriteoff()
  const rejectWriteoff = useRejectWriteoff()
  const deleteWriteoff = useDeleteWriteoff()
  const isPending =
    approveWriteoff.isPending || rejectWriteoff.isPending || deleteWriteoff.isPending

  const handleRequestAction = (action: WriteoffAction) => {
    setConfirmAction(action)
    setConfirmOpen(true)
  }

  const handleConfirm = () => {
    if (!confirmAction || isPending) return
    const { type, writeoff } = confirmAction
    const mutation = { approve: approveWriteoff, reject: rejectWriteoff, delete: deleteWriteoff }[
      type
    ]
    mutation.mutate(writeoff.id, { onSettled: () => setConfirmOpen(false) })
  }

  const hasFilters = statusFilter !== ALL || reasonFilter !== ALL

  return (
    // `@container`: lebar kolom produk di tabel mengikuti lebar area isi
    // (sidebar terbuka atau tertutup), bukan lebar jendela.
    <div className="@container flex flex-col gap-6">
      <NavbarActions>
        <Button size="sm" onPress={() => setFormOpen(true)}>
          <Plus />
          Buat Write-off
        </Button>
      </NavbarActions>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          aria-label="Filter status"
          className="w-full sm:w-44"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value ?? ALL)
            setPage(1)
          }}
        />

        <OptionSelect
          aria-label="Filter alasan"
          className="w-full sm:w-44"
          options={REASON_OPTIONS}
          value={reasonFilter}
          onChange={(value) => {
            setReasonFilter(value ?? ALL)
            setPage(1)
          }}
        />

        {data && (
          <p aria-live="polite" className="text-sm text-muted tabular-nums sm:ml-auto">
            {formatNumber(data.total)} write-off
          </p>
        )}
      </div>

      {error && !data ? (
        <LoadError
          isRetrying={isFetching}
          title={id.loadFailed.writeoffs}
          onRetry={() => refetch()}
        >
          {error.message}
        </LoadError>
      ) : (
        <div className="flex flex-col gap-4">
          <WriteoffTable
            hasFilters={hasFilters}
            isAdmin={isAdmin}
            isLoading={isLoading}
            isRefreshing={isPlaceholderData}
            writeoffs={data?.items ?? []}
            onAction={handleRequestAction}
          />
          <TablePagination page={page} totalPages={data?.totalPages ?? 1} onPageChange={setPage} />
        </div>
      )}

      <WriteoffFormDialog open={formOpen} onOpenChange={setFormOpen} />

      <WriteoffConfirmDialog
        action={confirmAction}
        isOpen={confirmOpen}
        isPending={isPending}
        onConfirm={handleConfirm}
        onOpenChange={setConfirmOpen}
      />
    </div>
  )
}
