import { Card, Chip } from "@heroui/react"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

/**
 * Satu kartu KPI: label, angka, dan lencana perubahan bila memang ada
 * pembandingnya. Tidak ada baris keempat.
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
}

export function StatCard({ label, value, delta = null, note }: StatCardProps) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const isUp = hasDelta && delta >= 0

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Description>{label}</Card.Description>
        {hasDelta ? (
          <Chip color={isUp ? "success" : "danger"} size="sm" variant="soft">
            {isUp ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
            <Chip.Label>
              {isUp ? "+" : ""}
              {delta.toFixed(1)}%
            </Chip.Label>
          </Chip>
        ) : note ? (
          <Chip size="sm">{note}</Chip>
        ) : null}
      </Card.Header>
      <Card.Content>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      </Card.Content>
    </Card>
  )
}
