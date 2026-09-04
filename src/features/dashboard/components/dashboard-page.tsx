import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
} from "recharts"
import {
  TrendingUpIcon,
  TrendingDownIcon,
  AlertTriangleIcon,
  DatabaseBackupIcon,
  HistoryIcon,
  PackageIcon,
  ShoppingCartIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { id as t } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCreateBackupMutation } from "@/features/settings/hooks/use-backup"
import {
  useDashboardSummary,
  useDailyRevenue,
  usePaymentMethodStats,
  useTopProducts,
  useLowStockProducts,
  useRecentTransactions,
} from "../hooks/use-dashboard"
import { formatDateTime, formatRupiah } from "@/lib/format"

// --- Helpers ---

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value)
}

// --- Chart Configs ---

const revenueChartConfig = {
  revenue: {
    label: t.dashboard.revenue,
    color: "var(--primary)",
  },
} satisfies ChartConfig

const paymentChartConfig = {
  total: { label: "Total" },
  cash: { label: t.payment.cash, color: "var(--chart-1)" },
  qris: { label: t.payment.qris, color: "var(--chart-2)" },
  debit: { label: t.payment.debit, color: "var(--chart-4)" },
  ewallet: { label: t.payment.ewallet, color: "var(--chart-3)" },
  transfer: { label: t.payment.transfer, color: "var(--chart-5)" },
} satisfies ChartConfig

// --- Sub-components ---

function SectionCards() {
  const { data: summary } = useDashboardSummary()

  const revenueChange = useMemo(() => {
    if (!summary) return 0
    if (summary.yesterdayRevenue > 0) {
      return ((summary.todayRevenue - summary.yesterdayRevenue) / summary.yesterdayRevenue) * 100
    }
    return summary.todayRevenue > 0 ? 100 : 0
  }, [summary])

  const marginPct = useMemo(() => {
    if (!summary || summary.todayRevenue <= 0) return 0
    return (summary.todayGrossProfit / summary.todayRevenue) * 100
  }, [summary])

  const isUp = revenueChange >= 0

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t.dashboard.todayRevenue}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatRupiah(summary?.todayRevenue ?? 0)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {isUp ? (
                <TrendingUpIcon />
              ) : (
                <TrendingDownIcon />
              )}
              {isUp ? "+" : ""}{revenueChange.toFixed(1)}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isUp ? t.dashboard.trendUp : t.dashboard.trendDown} {Math.abs(revenueChange).toFixed(1)}% {t.dashboard.vsYesterday}{" "}
            {isUp ? (
              <TrendingUpIcon className="size-4" />
            ) : (
              <TrendingDownIcon className="size-4" />
            )}
          </div>
          <div className="text-muted-foreground">
            {t.dashboard.revenueChartDescription}
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t.dashboard.grossProfit}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatRupiah(summary?.todayGrossProfit ?? 0)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon />
              {marginPct.toFixed(1)}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Margin {marginPct.toFixed(1)}% dari penjualan{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">
            {t.dashboard.todayRevenue}
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t.dashboard.todayTransactions}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatNumber(summary?.todayTransactions ?? 0)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon />
              {t.dashboard.completedTransactions}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {formatNumber(summary?.todayTransactions ?? 0)} {t.dashboard.completedTransactions}{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">
            {t.dashboard.todayBreakdown}
          </div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t.dashboard.avgPerTransaction}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {formatRupiah(summary?.todayAvgPerTransaction ?? 0)}
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {formatRupiah(summary?.todayAvgPerTransaction ?? 0)} {t.dashboard.perTransaction}{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">
            {t.dashboard.todayBreakdown}
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

function QuickActions() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const activeShift = useShiftStore((s) => s.activeShift)
  const fetchActiveShift = useShiftStore((s) => s.fetchActiveShift)
  const createBackupMutation = useCreateBackupMutation()
  const isAdmin = user?.role === "admin"

  useEffect(() => {
    if (user) {
      void fetchActiveShift(user.id)
    }
  }, [user, fetchActiveShift])

  const actions = [
    {
      title: activeShift ? "Lanjut transaksi" : "Buka shift dan mulai transaksi",
      description: activeShift
        ? "Masuk ke kasir dan teruskan transaksi aktif."
        : "Masuk ke kasir untuk buka shift dan mulai berjualan.",
      icon: <ShoppingCartIcon className="h-4 w-4" />,
      onClick: () => navigate("/cashier"),
      label: "Mulai Penjualan",
      variant: "default" as const,
      visible: true,
      loading: false,
    },
    {
      title: "Lihat riwayat transaksi",
      description: "Cek transaksi terbaru, pembayaran, dan detail struk.",
      icon: <HistoryIcon className="h-4 w-4" />,
      onClick: () => navigate("/transactions"),
      label: "Riwayat Transaksi",
      variant: "outline" as const,
      visible: true,
      loading: false,
    },
    {
      title: "Kelola produk",
      description: "Tambah, ubah, dan cek stok produk toko.",
      icon: <PackageIcon className="h-4 w-4" />,
      onClick: () => navigate("/products"),
      label: "Kelola Produk",
      variant: "outline" as const,
      visible: isAdmin,
      loading: false,
    },
    {
      title: "Backup data sekarang",
      description: "Buat backup manual sebelum update atau perubahan besar.",
      icon: <DatabaseBackupIcon className="h-4 w-4" />,
      onClick: () => createBackupMutation.mutate(),
      label: createBackupMutation.isPending ? "Membuat Backup..." : "Backup Sekarang",
      variant: "outline" as const,
      visible: isAdmin,
      loading: createBackupMutation.isPending,
    },
  ].filter((action) => action.visible)

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Aksi Cepat</CardTitle>
          <CardDescription>
            Buka area kerja utama tanpa harus berpindah-pindah menu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {actions.map((action) => (
              <Button
                key={action.title}
                variant={action.variant}
                className={`h-auto min-h-28 flex-col items-start gap-2 px-4 py-4 text-left ${
                  action.variant === "default" ? "text-primary-foreground hover:text-primary-foreground" : ""
                }`}
                onClick={action.onClick}
                disabled={action.loading}
              >
                <span className={`flex items-center gap-2 text-sm font-semibold ${
                  action.variant === "default" ? "text-primary-foreground" : ""
                }`}>
                  {action.icon}
                  {action.label}
                </span>
                <span className={`text-base font-semibold leading-tight ${
                  action.variant === "default" ? "text-primary-foreground" : "text-foreground"
                }`}>
                  {action.title}
                </span>
                <span className={`text-xs leading-relaxed ${
                  action.variant === "default" ? "text-primary-foreground/80" : "text-muted-foreground"
                }`}>
                  {action.description}
                </span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ChartRevenueInteractive() {
  const [timeRange, setTimeRange] = useState("7d")

  const daysMap: Record<string, number> = {
    "7d": 7,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "1y": 365,
  }
  const days = daysMap[timeRange] ?? 7
  const { data: dailyRevenue } = useDailyRevenue(days)

  const timeRangeOptions = [
    { value: "1y", label: t.dashboard.last1Year },
    { value: "6m", label: t.dashboard.last6Months },
    { value: "3m", label: t.dashboard.last3Months },
    { value: "1m", label: t.dashboard.last1Month },
    { value: "7d", label: t.dashboard.last1Week },
  ]

  const totalRevenue = useMemo(() => {
    if (!dailyRevenue) return 0
    return dailyRevenue.reduce((acc, curr) => acc + curr.revenue, 0)
  }, [dailyRevenue])

  const totalTransactions = useMemo(() => {
    if (!dailyRevenue) return 0
    return dailyRevenue.reduce((acc, curr) => acc + curr.transactions, 0)
  }, [dailyRevenue])

  return (
    <Card className="py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b p-0! sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pb-3 sm:pb-0">
          <CardTitle>{t.dashboard.revenueChart}</CardTitle>
          <CardDescription>
            {t.dashboard.revenueChartDescription}
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">
              {t.dashboard.revenue}
            </span>
            <span className="text-lg leading-none font-bold sm:text-3xl">
              {formatRupiah(totalRevenue)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">
              {t.dashboard.transactions}
            </span>
            <span className="text-lg leading-none font-bold sm:text-3xl">
              {totalTransactions.toLocaleString("id-ID")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-2 pt-4 sm:px-6 sm:pt-6">
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger
            className="w-[160px] rounded-lg sm:ml-auto"
            aria-label="Select a value"
          >
            <SelectValue placeholder={t.dashboard.last1Week} />
          </SelectTrigger>
          <SelectContent>
            {timeRangeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dailyRevenue && dailyRevenue.length > 0 ? (
          <ChartContainer
            config={revenueChartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <LineChart
              accessibilityLayer
              data={dailyRevenue}
              margin={{ left: 12, right: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value + "T00:00:00")
                  return date.toLocaleDateString("id-ID", {
                    month: "short",
                    day: "numeric",
                  })
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[180px]"
                    nameKey="revenue"
                    labelFormatter={(value) => {
                      return new Date(value + "T00:00:00").toLocaleDateString("id-ID", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    }}
                  />
                }
              />
              <Line
                dataKey="revenue"
                type="monotone"
                stroke="var(--color-revenue)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
            {t.dashboard.noData}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChartPaymentRadar() {
  const { data: paymentStats } = usePaymentMethodStats()

  const radarData = useMemo(() => {
    if (!paymentStats) return []
    return paymentStats.map((s) => {
      const config = paymentChartConfig[s.method as keyof typeof paymentChartConfig]
      return {
        method: config?.label ?? s.method,
        total: s.total,
        count: s.count,
      }
    })
  }, [paymentStats])

  const topPaymentMethod = useMemo(() => {
    if (!radarData.length) return null
    const paymentTotal = radarData.reduce((sum, item) => sum + item.total, 0)
    const top = radarData.reduce((a, b) => (a.total > b.total ? a : b))
    const pct = paymentTotal > 0 ? ((top.total / paymentTotal) * 100).toFixed(0) : "0"
    return { label: top.method, pct }
  }, [radarData])

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>{t.dashboard.paymentMethods}</CardTitle>
        <CardDescription>{t.dashboard.todayBreakdown}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        {radarData.length > 0 ? (
          <ChartContainer
            config={paymentChartConfig}
            className="mx-auto aspect-square max-h-[250px]"
          >
            <RadarChart data={radarData} outerRadius="70%">
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent />}
              />
              <PolarAngleAxis
                dataKey="method"
                tick={{ fontSize: 12 }}
              />
              <PolarGrid />
              <Radar
                dataKey="total"
                fill="var(--chart-1)"
                fillOpacity={0.6}
                dot={{
                  r: 4,
                  fillOpacity: 1,
                }}
              />
            </RadarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
            {t.dashboard.noData}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        {topPaymentMethod ? (
          <>
            <div className="flex items-center gap-2 leading-none font-medium">
              {topPaymentMethod.label} {t.dashboard.dominates} ({topPaymentMethod.pct}%)
              <TrendingUpIcon className="h-4 w-4" />
            </div>
            <div className="leading-none text-muted-foreground">
              {t.dashboard.todayBreakdown}
            </div>
          </>
        ) : (
          <div className="leading-none text-muted-foreground">
            {t.dashboard.noData}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

function TopProductsTable() {
  const { data: topProducts } = useTopProducts(5)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.topProducts}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.dashboard.productName}</TableHead>
              <TableHead className="text-right">{t.dashboard.qtySold}</TableHead>
              <TableHead className="text-right">{t.dashboard.totalRevenue}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topProducts && topProducts.length > 0 ? (
              topProducts.map((p) => (
                <TableRow key={p.productId}>
                  <TableCell className="font-medium truncate max-w-[150px]">
                    {p.productName}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(p.totalQty)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatRupiah(p.totalRevenue)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  {t.dashboard.noData}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function LowStockTable() {
  const { data: lowStock } = useLowStockProducts()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangleIcon className="size-4" />
          {t.dashboard.lowStock}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.dashboard.product}</TableHead>
              <TableHead className="text-right">{t.dashboard.stock}</TableHead>
              <TableHead className="text-right">{t.dashboard.minStock}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lowStock && lowStock.length > 0 ? (
              lowStock.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium truncate max-w-[150px]">
                    {p.name}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.stock === 0 ? (
                      <Badge variant="destructive">
                        0 {p.unit}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        {p.stock} {p.unit}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {p.minStock} {p.unit}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  {t.dashboard.noData}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function RecentTransactionsTable() {
  const { data: recentTx } = useRecentTransactions()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.recentTransactions}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>{t.dashboard.receipt}</TableHead>
              <TableHead>{t.dashboard.cashier}</TableHead>
              <TableHead>Metode</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-center">Item</TableHead>
              <TableHead className="text-right">{t.dashboard.amount}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTx && recentTx.length > 0 ? (
              recentTx.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-medium">{tx.receiptNumber}</TableCell>
                  <TableCell>{tx.cashierName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t.payment[tx.paymentMethod as keyof typeof t.payment] ?? tx.paymentMethod}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(tx.createdAt)}</TableCell>
                  <TableCell className="text-center">{tx.totalItems}</TableCell>
                  <TableCell className="text-right font-medium">{formatRupiah(tx.totalAmount)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t.dashboard.noData}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// --- Main Page ---

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 @container/main">
      <SectionCards />
      <QuickActions />
      <div className="px-4 lg:px-6">
        <ChartRevenueInteractive />
      </div>
      <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-3 lg:px-6">
        <ChartPaymentRadar />
        <TopProductsTable />
        <LowStockTable />
      </div>
      <div className="px-4 lg:px-6">
        <RecentTransactionsTable />
      </div>
    </div>
  )
}
