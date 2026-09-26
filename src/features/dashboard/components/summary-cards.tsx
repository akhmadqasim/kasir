import { useMemo } from "react"
import { Card } from "@heroui/react"

import { LoadError } from "@/components/load-error"
import { StatCard } from "@/components/stat-card"
import { StatSkeleton } from "@/features/reports/components/report-shell"
import { id as t } from "@/i18n/id"
import { formatNumber, formatPercent, formatRupiah } from "@/lib/format"
import { useDashboardSummary } from "../hooks/use-dashboard"

/**
 * Empat angka hari ini, dibaca sekali lihat.
 *
 * Hanya penjualan yang punya pembanding — backend mengirim `yesterdayRevenue`,
 * dan tidak ada padanannya untuk laba, jumlah transaksi, maupun rata-rata. Dua
 * kartu terakhir karena itu tampil tanpa lencana sama sekali; laba memakai
 * lencana netral berisi marginnya, yang memang rasio dan bukan tren.
 *
 * Selama permintaan pertama angkanya `Skeleton`, bukan "Rp 0": nol di layar
 * uang adalah angka, dan kasir membacanya sebagai "belum ada penjualan".
 */
export function SummaryCards() {
  const { data: summary, isLoading, isFetching, error, refetch } = useDashboardSummary()

  const revenueChange = useMemo(() => {
    if (!summary) return null
    if (summary.yesterdayRevenue > 0) {
      return ((summary.todayRevenue - summary.yesterdayRevenue) / summary.yesterdayRevenue) * 100
    }
    // Tanpa penjualan kemarin tidak ada dasar persentase. Menyebutnya +100%
    // membuat hari pertama berjualan terlihat seperti pertumbuhan; yang benar
    // adalah tidak ada angka untuk dibandingkan.
    return null
  }, [summary])

  const marginPct = useMemo(() => {
    if (!summary || summary.todayRevenue <= 0) return null
    return (summary.todayGrossProfit / summary.todayRevenue) * 100
  }, [summary])

  // Gagal tanpa angka lama untuk ditampilkan: satu pesan, bukan empat kartu
  // berisi nol yang tampak seperti hari tanpa penjualan.
  if (error && !summary) {
    return (
      <Card>
        <LoadError
          isRetrying={isFetching}
          title={t.loadFailed.todaySummary}
          onRetry={() => void refetch()}
        >
          {error.message}
        </LoadError>
      </Card>
    )
  }

  // The same number placeholder the report cards use.
  const value = (formatted: string) => (isLoading ? <StatSkeleton /> : formatted)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        delta={revenueChange}
        label={t.dashboard.todayRevenue}
        value={value(formatRupiah(summary?.todayRevenue ?? 0))}
      />
      <StatCard
        label={t.dashboard.grossProfit}
        note={marginPct === null ? undefined : `Margin ${formatPercent(marginPct)}%`}
        value={value(formatRupiah(summary?.todayGrossProfit ?? 0))}
      />
      <StatCard
        label={t.dashboard.todayTransactions}
        value={value(formatNumber(summary?.todayTransactions ?? 0))}
      />
      <StatCard
        label={t.dashboard.avgPerTransaction}
        value={value(formatRupiah(summary?.todayAvgPerTransaction ?? 0))}
      />
    </div>
  )
}
