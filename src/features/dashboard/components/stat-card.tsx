import type { ReactNode } from "react"
import { Card, Chip } from "@heroui/react"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

/**
 * Satu kartu KPI: label kecil, angka besar, lencana perubahan di kanan atas.
 *
 * `delta` sengaja boleh `null` dan bukan `number` dengan nilai bawaan `0`. Dari
 * empat angka di baris atas dashboard, hanya penjualan yang punya angka kemarin
 * untuk dibandingkan. Versi sebelumnya menempelkan panah naik pada keempatnya,
 * sehingga jumlah transaksi dan rata-rata tampak sedang tumbuh padahal tidak
 * pernah diukur. `null` berarti "tidak ada pembandingnya", dan lencananya tidak
 * digambar sama sekali.
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
  /** Satu baris keterangan di bawah angka. */
  hint?: ReactNode
}

export function StatCard({ label, value, delta = null, note, hint }: StatCardProps) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const isUp = hasDelta && delta >= 0

  return (
    <Card className="gap-0 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        {hasDelta ? (
          <Chip color={isUp ? "success" : "danger"} size="sm" variant="soft">
            {isUp ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
            <Chip.Label>
              {isUp ? "+" : ""}
              {delta.toFixed(1)}%
            </Chip.Label>
          </Chip>
        ) : note ? (
          <Chip size="sm" variant="soft">
            <Chip.Label>{note}</Chip.Label>
          </Chip>
        ) : null}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  )
}
