import { useMemo } from "react"
import { Card } from "@heroui/react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { id as t } from "@/i18n/id"
import { formatCompactRupiah, formatRupiah } from "@/lib/format"
import { METHOD_COLORS, paymentMethodColor as colorFor, paymentMethodLabel } from "@/lib/labels"
import { NoData } from "@/components/no-data"
import type { PaymentMethodDaily } from "../types"
import { usePaymentMethodDaily } from "../hooks/use-dashboard"
import { longDate, shortDate } from "./chart-dates"
import { InlineStat } from "./inline-stat"

/** Baris panjang dari API menjadi satu baris per tanggal, satu kolom per metode. */
function pivot(rows: PaymentMethodDaily[]) {
  const byDate = new Map<string, Record<string, string | number>>()
  for (const row of rows) {
    const existing = byDate.get(row.date) ?? { date: row.date }
    existing[row.method] = row.total
    byDate.set(row.date, existing)
  }
  return [...byDate.values()]
}

/**
 * Tren nilai penjualan per metode pembayaran.
 *
 * Menggantikan radar chart warisan shadcn. Radar memberi satu bentuk untuk satu
 * hari dan tidak bisa menjawab pertanyaan yang sebenarnya ditanyakan pemilik
 * toko — apakah QRIS naik terhadap tunai — karena sumbunya tidak punya waktu.
 */
export function PaymentTrendChart({ days }: { days: number }) {
  const { data: rows } = usePaymentMethodDaily(days)

  const methods = useMemo(() => {
    const seen = [...new Set((rows ?? []).map((row) => row.method))]
    // Urutan tetap mengikuti daftar warna, supaya legendanya tidak berpindah
    // tempat saat sebuah metode baru muncul di tengah periode.
    const known = Object.keys(METHOD_COLORS).filter((method) => seen.includes(method))
    const unknown = seen.filter((method) => !(method in METHOD_COLORS)).sort()
    return [...known, ...unknown]
  }, [rows])

  const chartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        methods.map((method) => [
          method,
          { label: paymentMethodLabel(method), color: colorFor(method) },
        ]),
      ),
    [methods],
  )

  const data = useMemo(() => pivot(rows ?? []), [rows])
  const total = useMemo(() => (rows ?? []).reduce((sum, row) => sum + row.total, 0), [rows])
  // Sama seperti grafik penjualan: baris nol untuk mengisi hari kosong bukan
  // data yang bisa digambar.
  const hasData = methods.length > 0 && (rows ?? []).some((row) => row.total !== 0)

  return (
    <Card>
      <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
        <Card.Title>{t.dashboard.paymentMethods}</Card.Title>
        {hasData ? (
          <ul
            aria-label="Legenda metode pembayaran"
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            {methods.map((method) => (
              <li key={method} className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: colorFor(method) }}
                />
                {paymentMethodLabel(method)}
              </li>
            ))}
          </ul>
        ) : null}
      </Card.Header>
      <Card.Content className="gap-4">
        <InlineStat label={t.dashboard.totalRevenue} value={formatRupiah(total)} />

        {hasData ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
            <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
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
                width={52}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatRupiah(Number(value))}
                    labelFormatter={(value) => longDate(String(value))}
                  />
                }
              />
              {methods.map((method) => (
                <Line
                  key={method}
                  dataKey={method}
                  dot={false}
                  stroke={`var(--color-${method})`}
                  strokeWidth={2}
                  type="monotone"
                />
              ))}
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[240px] items-center justify-center">
            <NoData />
          </div>
        )}
      </Card.Content>
    </Card>
  )
}
