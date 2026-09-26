import { Check, Trash2, X } from "lucide-react"
import { Button } from "@heroui/react"

import type { WriteoffAction } from "./writeoff-confirm-dialog"
import type { StockWriteoff } from "../types"

interface WriteoffActionsProps {
  writeoff: StockWriteoff
  isAdmin: boolean
  onAction: (action: WriteoffAction) => void
}

/** Setujui / tolak / hapus untuk satu baris write-off yang masih menunggu. */
export function WriteoffActions({ writeoff, isAdmin, onAction }: WriteoffActionsProps) {
  if (writeoff.status !== "pending" || !isAdmin) {
    // Kasir tidak punya aksi di sini; sel kosong tanpa tanda terlihat seperti
    // tabel yang belum selesai dimuat.
    return (
      <span className="text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Tidak ada aksi</span>
      </span>
    )
  }

  // Aksi baris mengikuti contoh "Custom Cells" tabel HeroUI: `tertiary` untuk
  // aksi biasa, `danger-soft` untuk yang merusak. Setujui bukan `primary` —
  // satu tombol primary per baris berarti sepuluh primary per layar, dan yang
  // memajukan pekerjaan di halaman ini adalah "Buat Write-off" di navbar.
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        aria-label={`Setujui ${writeoff.writeoffNumber}`}
        isIconOnly
        size="sm"
        variant="tertiary"
        onPress={() => onAction({ type: "approve", writeoff })}
      >
        <Check />
      </Button>
      <Button
        aria-label={`Tolak ${writeoff.writeoffNumber}`}
        isIconOnly
        size="sm"
        variant="danger-soft"
        onPress={() => onAction({ type: "reject", writeoff })}
      >
        <X />
      </Button>
      {/* Server menolak menghapus write-off yang berasal dari refund; yang
          itu hanya bisa ditolak. */}
      {writeoff.refundId == null && (
        <Button
          aria-label={`Hapus ${writeoff.writeoffNumber}`}
          isIconOnly
          size="sm"
          variant="danger-soft"
          onPress={() => onAction({ type: "delete", writeoff })}
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}
