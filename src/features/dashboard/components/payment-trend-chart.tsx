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
import { paymentMethodLabel } from "@/lib/labels"
import { usePaymentMethodDaily } from "../hooks/use-dashboard"

/**
 * Warna per metode, dipatok bukan dibagikan menurut urutan kemunculan.
 *
 * Kalau warnanya diambil berurutan dari data, hari pertama toko tidak menerima
 * QRIS akan menggeser seluruh warna satu langkah, dan kasir yang sudah hafal
 * "garis biru itu tunai" membaca grafik yang salah. `mixed` sengaja abu-abu:
 * ia bukan metode yang bisa dipilih, melainkan penanda transaksi yang dibayar
 * dengan beberapa metode sekaligus.
 */
const METHOD_COLORS: Record<string, string> = {
  cash: "var(--chart-1)",
  qris: "var(--chart-2)",
  debit: "var(--chart-3)",
  ewallet: "var(--chart-4)",
  transfer: "var(--chart-5)",
  mixed: "var(--muted)",
}

/** Metode di luar daftar tetap tergambar, memakai warna aksen. */
function colorFor(method: string): string {
  return METHOD_COLORS[method] ?? "var(--accent)"
}

/** Baris panjang dari API menjadi satu baris per tanggal, satu kolom per metode. */
function pivot(rows: { date: string; method: string; total: number }[]) {
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
  const hasData = data.length > 0 && methods.length > 0

  return (
    <Card className="gap-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Card.Title className="text-base">{t.dashboard.paymentMethods}</Card.Title>
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
      </div>

      <p className="mt-4 text-xl font-semibold tracking-tight tabular-nums">
        {formatRupiah(total)}
      </p>
      <p className="text-xs text-muted">{t.dashboard.totalRevenue}</p>

      {hasData ? (
        <ChartContainer config={chartConfig} className="mt-6 aspect-auto h-[260px] w-full">
          <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={24}
              tickFormatter={(value: string) =>
                new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
                  month: "short",
                  day: "numeric",
                })
              }
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
                  formatter={(value) => formatRupiah(Number(value))}
                  labelFormatter={(value) =>
                    new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  }
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
        <div className="mt-6 flex h-[260px] items-center justify-center text-muted">
          {t.dashboard.noData}
        </div>
      )}
    </Card>
  )
}
