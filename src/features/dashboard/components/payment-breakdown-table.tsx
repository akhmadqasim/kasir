import { useMemo } from "react"
import { Table } from "@heroui/react"

import { id as t } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { usePaymentMethodStats } from "../hooks/use-dashboard"
import { NoData } from "@/components/no-data"
import { SectionCard } from "./section-card"

/**
 * Rincian nominal per metode pembayaran hari ini.
 *
 * Angkanya bersih: retur dipotong dari metode uangnya dikembalikan, jadi sebuah
 * metode bisa bernilai negatif pada hari ketika retur melampaui penjualannya.
 * Porsinya dihitung terhadap jumlah nilai mutlak — memakai jumlah bertanda akan
 * membuat porsi melebihi 100% begitu ada satu baris negatif.
 */
export function PaymentBreakdownTable() {
  const { data: stats } = usePaymentMethodStats()

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
    <SectionCard title={t.dashboard.paymentMethods}>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={t.dashboard.paymentMethods}>
            <Table.Header>
              <Table.Column isRowHeader>Metode</Table.Column>
              <Table.Column className="text-right">{t.dashboard.transactions}</Table.Column>
              <Table.Column className="text-right">{t.dashboard.totalRevenue}</Table.Column>
              <Table.Column className="text-right">Porsi</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <NoData />}>
              {rows.map((stat) => (
                <Table.Row
                  key={stat.method}
                  id={stat.method}
                  textValue={paymentMethodLabel(stat.method)}
                >
                  <Table.Cell className="font-medium">{paymentMethodLabel(stat.method)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatNumber(stat.count)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatRupiah(stat.total)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-muted">
                    {stat.share.toFixed(0)}%
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </SectionCard>
  )
}
