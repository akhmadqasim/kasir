import { id } from "@/i18n/id"

import { StatCard } from "@/components/stat-card"
import { formatNumber, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { profitTone, type SalesTotals } from "../sales-totals"
import { StatSkeleton } from "./report-shell"

interface SalesSummaryCardsProps {
  /** `undefined` selagi laporan dimuat — kartunya tetap digambar dengan kerangka angka. */
  totals: SalesTotals | undefined
  isLoading: boolean
  /** Kartu kelima "Rata-rata / Transaksi", milik Penjualan per Periode saja. */
  withAverage?: boolean
  /** Angka kartu kelima, dari backend — tidak dihitung ulang dari `totals`. */
  averagePerTransaction?: number
}

/**
 * Kartu ringkasan tiga laporan penjualan (per hari, per bulan, per periode):
 * transaksi, pendapatan, modal, dan laba kotor yang merah bila rugi.
 *
 * Tidak digambar sama sekali kalau laporannya gagal tanpa data — keadaan
 * gagal sudah ditulis di tabel, dan empat kartu kosong hanya mengulangnya.
 */
export function SalesSummaryCards({
  totals,
  isLoading,
  withAverage = false,
  averagePerTransaction,
}: SalesSummaryCardsProps) {
  if (!isLoading && !totals) return null

  const amount = (value: number | undefined) =>
    value === undefined ? <StatSkeleton /> : formatRupiah(value)

  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2",
        // Lima kartu: 3+2 di grid tiga kolom menyisakan satu petak kosong.
        // Di bawah 2xl pakai enam kolom — tiga kartu atas masing-masing dua
        // kolom, dua kartu bawah masing-masing tiga — supaya kedua baris
        // penuh. Di dua kolom (sm) kartu kelima mengambil satu baris penuh.
        withAverage
          ? "sm:max-lg:[&>*:last-child]:col-span-2 lg:max-2xl:grid-cols-6 lg:max-2xl:*:col-span-2 lg:max-2xl:[&>*:nth-child(n+4)]:col-span-3 2xl:grid-cols-5"
          : "xl:grid-cols-4",
      )}
    >
      <StatCard
        label={id.reports.stat.totalTransactions}
        value={totals ? formatNumber(totals.transactions) : <StatSkeleton />}
      />
      <StatCard label={id.reports.stat.totalRevenue} value={amount(totals?.revenue)} />
      <StatCard label={id.reports.stat.totalCost} value={amount(totals?.cost)} />
      <StatCard
        label={id.reports.stat.grossProfit}
        tone={totals ? profitTone(totals.profit) : "default"}
        value={amount(totals?.profit)}
      />
      {withAverage && (
        <StatCard label={id.reports.stat.avgPerTransaction} value={amount(averagePerTransaction)} />
      )}
    </div>
  )
}
