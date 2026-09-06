import { useMemo } from "react"

import { id as t } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useDashboardSummary } from "../hooks/use-dashboard"
import { StatCard } from "./stat-card"

/**
 * Empat angka hari ini, dibaca sekali lihat.
 *
 * Hanya penjualan yang punya pembanding — backend mengirim `yesterdayRevenue`,
 * dan tidak ada padanannya untuk laba, jumlah transaksi, maupun rata-rata. Tiga
 * kartu sisanya karena itu tampil tanpa lencana perubahan; laba memakai lencana
 * netral berisi marginnya, yang memang rasio dan bukan tren.
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
        hint={revenueChange === null ? "Belum ada angka kemarin" : t.dashboard.vsYesterday}
        label={t.dashboard.todayRevenue}
        value={formatRupiah(summary?.todayRevenue ?? 0)}
      />
      <StatCard
        hint="Penjualan dikurangi harga modal"
        label={t.dashboard.grossProfit}
        note={marginPct === null ? undefined : `${marginPct.toFixed(1)}%`}
        value={formatRupiah(summary?.todayGrossProfit ?? 0)}
      />
      <StatCard
        hint={t.dashboard.completedTransactions}
        label={t.dashboard.todayTransactions}
        value={formatNumber(summary?.todayTransactions ?? 0)}
      />
      <StatCard
        hint={t.dashboard.perTransaction}
        label={t.dashboard.avgPerTransaction}
        value={formatRupiah(summary?.todayAvgPerTransaction ?? 0)}
      />
    </div>
  )
}
