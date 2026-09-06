import type { ReactNode } from "react"
import { Card, Chip } from "@heroui/react"

import { id as t } from "@/i18n/id"
import { formatNumber } from "@/lib/format"

/**
 * Pembungkus setiap daftar di dashboard: judul, jumlah baris, lalu isinya.
 *
 * Angka di sebelah judul bukan hiasan. Semua tabel di sini dipotong (lima produk
 * terlaris, sepuluh transaksi terakhir), dan tanpa jumlahnya pembaca tidak bisa
 * membedakan "hanya segini yang ada" dari "sisanya dipotong".
 */
export interface SectionCardProps {
  title: string
  /** Jumlah baris yang ditampilkan. Dihilangkan bila tidak bermakna. */
  count?: number
  /** Keterangan satu baris di bawah judul, misalnya cakupan waktunya. */
  description?: string
  /** Kontrol di ujung kanan judul, misalnya kolom pencarian. */
  action?: ReactNode
  children: ReactNode
}

export function SectionCard({ title, count, description, action, children }: SectionCardProps) {
  return (
    <Card className="gap-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Card.Title className="text-base">{title}</Card.Title>
            {typeof count === "number" ? (
              <Chip size="sm" variant="soft">
                <Chip.Label>{formatNumber(count)}</Chip.Label>
              </Chip>
            ) : null}
          </div>
          {description ? (
            <Card.Description className="mt-0.5">{description}</Card.Description>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

/** Isi tabel dashboard yang kosong: satu pesan, bukan sel ber-`colSpan`. */
export function NoData() {
  return <p className="py-8 text-center text-sm text-muted">{t.dashboard.noData}</p>
}
