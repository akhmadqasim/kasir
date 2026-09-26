import { useMemo } from "react"
import { Card, Skeleton } from "@heroui/react"
import { ChartColumnIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { CardHeading } from "@/components/card-heading"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { id as t } from "@/i18n/id"
import { formatCompactRupiah, formatNumber, formatRupiah } from "@/lib/format"
import { useDailyRevenue } from "../hooks/use-dashboard"
import { dayTicks, longDate, shortDate } from "./chart-dates"
import { rupiahTooltipValue } from "./chart-tooltip"
import { ChartPlaceholder } from "./chart-placeholder"
import { InlineStat } from "./inline-stat"

const revenueChartConfig = {
  revenue: {
    label: t.dashboard.revenue,
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

/**
 * Penjualan bersih per hari, digambar sebagai batang.
 *
 * Batang, bukan garis: sumbu-x-nya hari kalender yang berdiri sendiri, dan
 * garis di antara dua hari menyiratkan nilai antara yang tidak pernah ada.
 */
export function RevenueChart({ days }: { days: number }) {
  const { data: dailyRevenue, isLoading, isFetching, error, refetch } = useDailyRevenue(days)

  const totals = useMemo(() => {
    const rows = dailyRevenue ?? []
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
    return {
      revenue,
      transactions: rows.reduce((sum, row) => sum + row.transactions, 0),
      perDay: rows.length > 0 ? revenue / rows.length : 0,
    }
  }, [dailyRevenue])

  // Backend mengisi setiap hari dalam rentang, termasuk yang nol, supaya
  // sumbu-x-nya utuh. Kalau semuanya nol tidak ada yang bisa digambar — grid
  // kosong dengan sumbu 0–4 hanya membuat orang mencari batang yang tidak ada.
  const hasData = (dailyRevenue ?? []).some((row) => row.revenue !== 0 || row.transactions > 0)
  const xTicks = useMemo(
    () => dayTicks((dailyRevenue ?? []).map((row) => row.date)),
    [dailyRevenue],
  )
  const statValue = (value: string) => (isLoading ? <Skeleton className="h-7 w-24" /> : value)

  return (
    <Card>
      <Card.Header>
        <CardHeading>{t.dashboard.revenueChart}</CardHeading>
      </Card.Header>
      <Card.Content className="gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <InlineStat
            label={t.dashboard.totalRevenue}
            value={statValue(formatRupiah(totals.revenue))}
          />
          <InlineStat label="Rata-rata per hari" value={statValue(formatRupiah(totals.perDay))} />
          <InlineStat
            label={t.dashboard.transactions}
            value={statValue(formatNumber(totals.transactions))}
          />
        </div>

        {hasData ? (
          <ChartContainer
            aria-label={`Grafik batang penjualan per hari, ${days} hari terakhir`}
            className="aspect-auto h-[240px] w-full"
            config={revenueChartConfig}
            role="group"
          >
            <BarChart accessibilityLayer data={dailyRevenue} margin={{ left: 4, right: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                interval={0}
                tickFormatter={shortDate}
                ticks={xTicks}
                tickLine={false}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                tickFormatter={formatCompactRupiah}
                tickLine={false}
                tickMargin={8}
                width={52}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={rupiahTooltipValue}
                    labelFormatter={(value) => longDate(String(value))}
                    nameKey="revenue"
                  />
                }
              />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        ) : (
          <ChartPlaceholder
            emptyDescription={t.empty.salesChartHint}
            emptyIcon={<ChartColumnIcon />}
            emptyTitle={t.empty.sales}
            error={error}
            isLoading={isLoading}
            isRetrying={isFetching}
            onRetry={() => void refetch()}
          />
        )}
      </Card.Content>
    </Card>
  )
}
