import { useMemo } from "react"
import { Table } from "@heroui/react"
import { WalletCardsIcon } from "lucide-react"

import { id as t } from "@/i18n/id"
import { formatNumber, formatPercent, formatRupiah } from "@/lib/format"
import { paymentMethodColor, paymentMethodLabel } from "@/lib/labels"
import { usePaymentMethodStats } from "../hooks/use-dashboard"
import { DashboardTable } from "./dashboard-table"

/**
 * Rincian nominal per metode pembayaran hari ini.
 *
 * Angkanya bersih: retur dipotong dari metode uangnya dikembalikan, jadi sebuah
 * metode bisa bernilai negatif pada hari ketika retur melampaui penjualannya.
 * Porsinya dihitung terhadap jumlah nilai mutlak — memakai jumlah bertanda akan
 * membuat porsi melebihi 100% begitu ada satu baris negatif.
 */
export function PaymentBreakdownTable() {
  const { data: stats, isLoading, isFetching, error, refetch } = usePaymentMethodStats()

  const rows = useMemo(() => {
    const source = stats ?? []
    const magnitude = source.reduce((sum, stat) => sum + Math.abs(stat.total), 0)
    return source
      .map((stat) => ({
        ...stat,
        share: magnitude > 0 ? (Math.abs(stat.total) / magnitude) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [stats])

  return (
    <DashboardTable
      columnCount={4}
      emptyIcon={<WalletCardsIcon />}
      emptyTitle={t.empty.paymentsToday}
      error={error}
      isLoading={isLoading}
      title={t.dashboard.paymentMethods}
      columns={
        <>
          <Table.Column isRowHeader>Metode</Table.Column>
          <Table.Column className="text-right">{t.dashboard.transactions}</Table.Column>
          <Table.Column className="text-right">{t.dashboard.totalRevenue}</Table.Column>
          <Table.Column className="text-right">Porsi</Table.Column>
        </>
      }
      isRetrying={isFetching}
      onRetry={() => void refetch()}
    >
      {rows.map((stat) => (
        <Table.Row key={stat.method} id={stat.method} textValue={paymentMethodLabel(stat.method)}>
          {/* Titik warnanya sama dengan garis metode ini di grafik tab Ringkasan,
              jadi kasir yang hafal "hijau itu QRIS" membaca keduanya sekaligus.
              Namanya tetap tertulis — warnanya hanya penghubung. */}
          <Table.Cell className="font-medium">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: paymentMethodColor(stat.method) }}
              />
              {paymentMethodLabel(stat.method)}
            </span>
          </Table.Cell>
          <Table.Cell className="text-right">{formatNumber(stat.count)}</Table.Cell>
          <Table.Cell className="text-right">{formatRupiah(stat.total)}</Table.Cell>
          <Table.Cell className="text-right text-muted">{formatPercent(stat.share)}%</Table.Cell>
        </Table.Row>
      ))}
    </DashboardTable>
  )
}
