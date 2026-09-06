import { useMemo } from "react"
import { Card } from "@heroui/react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { id as t } from "@/i18n/id"
import { formatCompactRupiah, formatNumber, formatRupiah } from "@/lib/format"
import { useDailyRevenue } from "../hooks/use-dashboard"
import { InlineStat } from "./inline-stat"

const revenueChartConfig = {
  revenue: {
    label: t.dashboard.revenue,
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

/** "5 Sep" — cukup untuk sumbu, tanpa tahun yang selalu sama. */
function shortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
    month: "short",
    day: "numeric",
  })
}

/**
 * Penjualan bersih per hari, digambar sebagai batang.
 *
 * Batang, bukan garis: sumbu-x-nya hari kalender yang berdiri sendiri, dan
 * garis di antara dua hari menyiratkan nilai antara yang tidak pernah ada.
 * Bentuk ini juga yang dipakai contoh HeroUI untuk data harian.
 */
export function RevenueChart({ days }: { days: number }) {
  const { data: dailyRevenue } = useDailyRevenue(days)

  const totals = useMemo(() => {
    const rows = dailyRevenue ?? []
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
    const transactions = rows.reduce((sum, row) => sum + row.transactions, 0)
    return {
      revenue,
      transactions,
      perDay: rows.length > 0 ? revenue / rows.length : 0,
    }
  }, [dailyRevenue])

  const hasData = (dailyRevenue?.length ?? 0) > 0

  return (
    <Card className="gap-0 p-5">
      <Card.Title className="text-base">{t.dashboard.revenueChart}</Card.Title>
      <Card.Description className="mt-0.5">{t.dashboard.revenueChartDescription}</Card.Description>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <InlineStat label={t.dashboard.totalRevenue} value={formatRupiah(totals.revenue)} />
        <InlineStat label="Rata-rata per hari" value={formatRupiah(totals.perDay)} />
        <InlineStat label={t.dashboard.transactions} value={formatNumber(totals.transactions)} />
      </div>

      {hasData ? (
        <ChartContainer config={revenueChartConfig} className="mt-6 aspect-auto h-[260px] w-full">
          <BarChart accessibilityLayer data={dailyRevenue} margin={{ left: 4, right: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={24}
              tickFormatter={shortDate}
              tickLine={false}
              tickMargin={10}
            />
            <YAxis
              axisLine={false}
              tickFormatter={formatCompactRupiah}
              tickLine={false}
              tickMargin={8}
              width={56}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[190px]"
                  formatter={(value) => formatRupiah(Number(value))}
                  labelFormatter={(value) =>
                    new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  }
                  nameKey="revenue"
                />
              }
            />
            <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartContainer>
      ) : (
        <div className="mt-6 flex h-[260px] items-center justify-center text-muted">
          {t.dashboard.noData}
        </div>
      )}
    </Card>
  )
}
