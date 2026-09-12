import type { ReactNode } from "react"
import { Card, Chip } from "@heroui/react"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Satu kartu KPI: label, angka, dan lencana perubahan bila memang ada
 * pembandingnya. Tidak ada baris keempat.
 *
 * Naik dari `features/dashboard` karena kartu yang sama ternyata ditulis ulang
 * di laporan, shift, stok, dan PPOB — enam bentuk untuk satu benda. Yang
 * membedakan mereka hanya warna angkanya (kerugian merah, saldo hijau) dan
 * satu kontrol kecil di kanan kepala; keduanya jadi prop di sini, bukan alasan
 * untuk kartu baru.
 *
 * `delta` sengaja boleh `null` dan bukan `number` dengan nilai bawaan `0`. Dari
 * empat angka di baris atas dashboard, hanya penjualan yang punya angka kemarin
 * untuk dibandingkan. Versi sebelumnya menempelkan panah naik pada keempatnya,
 * sehingga jumlah transaksi tampak sedang tumbuh padahal tidak pernah diukur.
 * Tidak adanya lencana sudah cukup mengatakan tidak ada yang dibandingkan.
 */
export interface StatCardProps {
  label: string
  value: string
  /** Persentase perubahan terhadap periode sebelumnya. `null` = tanpa pembanding. */
  delta?: number | null
  /**
   * Lencana netral, untuk angka yang bukan perubahan — margin, misalnya.
   * Diabaikan bila `delta` ada, karena satu kartu hanya punya satu lencana.
   */
  note?: string
  /**
   * Warna angkanya. Hanya untuk nilai yang maknanya memang searah dengan
   * warnanya — kerugian selalu `danger`, saldo masuk selalu `success`. Angka
   * yang bisa naik-turun tetap `default`; arahnya dinyatakan lewat `delta`.
   */
  tone?: "default" | "success" | "danger"
  /** Kontrol di kanan kepala kartu — tombol muat-ulang saldo, misalnya. Menggeser lencana. */
  action?: ReactNode
  /** Baris tambahan di bawah angka, di dalam `Card.Content`. */
  children?: ReactNode
  /** Isi `Card.Footer` — bilah persentase di kartu metode pembayaran. */
  footer?: ReactNode
}

const TONE_CLASS: Record<NonNullable<StatCardProps["tone"]>, string | undefined> = {
  default: undefined,
  success: "text-success",
  danger: "text-danger",
}

export function StatCard({
  label,
  value,
  delta = null,
  note,
  tone = "default",
  action,
  children,
  footer,
}: StatCardProps) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const isUp = hasDelta && delta >= 0

  const badge = hasDelta ? (
    <Chip color={isUp ? "success" : "danger"} size="sm" variant="soft">
      {isUp ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
      <Chip.Label>
        {isUp ? "+" : ""}
        {delta.toFixed(1)}%
      </Chip.Label>
    </Chip>
  ) : note ? (
    <Chip size="sm">{note}</Chip>
  ) : null

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Description>{label}</Card.Description>
        {/* Lencana dan kontrol dibungkus satu supaya `justify-between` tetap
            membelah kepala jadi dua sisi, bukan tiga. */}
        {badge || action ? (
          <div className="flex items-center gap-2">
            {badge}
            {action}
          </div>
        ) : null}
      </Card.Header>
      <Card.Content>
        <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", TONE_CLASS[tone])}>
          {value}
        </p>
        {children}
      </Card.Content>
      {footer ? <Card.Footer>{footer}</Card.Footer> : null}
    </Card>
  )
}
