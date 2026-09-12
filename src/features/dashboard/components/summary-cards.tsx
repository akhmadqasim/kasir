import { useMemo } from "react"

import { StatCard } from "@/components/stat-card"
import { id as t } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useDashboardSummary } from "../hooks/use-dashboard"

/**
 * Empat angka hari ini, dibaca sekali lihat.
 *
 * Hanya penjualan yang punya pembanding — backend mengirim `yesterdayRevenue`,
 * dan tidak ada padanannya untuk laba, jumlah transaksi, maupun rata-rata. Dua
 * kartu terakhir karena itu tampil tanpa lencana sama sekali; laba memakai
 * lencana netral berisi marginnya, yang memang rasio dan bukan tren.
 */
export function SummaryCards() {
  const { data: summary } = useDashboardSummary()

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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        delta={revenueChange}
        label={t.dashboard.todayRevenue}
        value={formatRupiah(summary?.todayRevenue ?? 0)}
      />
      <StatCard
        label={t.dashboard.grossProfit}
        note={marginPct === null ? undefined : `${marginPct.toFixed(1)}%`}
        value={formatRupiah(summary?.todayGrossProfit ?? 0)}
      />
      <StatCard
        label={t.dashboard.todayTransactions}
        value={formatNumber(summary?.todayTransactions ?? 0)}
      />
      <StatCard
        label={t.dashboard.avgPerTransaction}
        value={formatRupiah(summary?.todayAvgPerTransaction ?? 0)}
      />
    </div>
  )
}
