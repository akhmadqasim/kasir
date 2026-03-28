import { useMemo, useState, useEffect } from "react"
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
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  Pie,
  PieChart,
} from "recharts"
import {
  TrendingUpIcon,
  TrendingDownIcon,
  AlertTriangleIcon,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { id as t } from "@/i18n/id"
import {
  useDashboardSummary,
  useDailyRevenue,
  usePaymentMethodStats,
  useTopProducts,
  useLowStockProducts,
  useRecentTransactions,
} from "../hooks/use-dashboard"

// --- Helpers ---

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value)
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
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
  ewallet: { label: t.payment.ewallet, color: "var(--chart-3)" },
  transfer: { label: t.payment.transfer, color: "var(--chart-4)" },
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
            {formatCurrency(summary?.todayRevenue ?? 0)}
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
            {formatCurrency(summary?.todayGrossProfit ?? 0)}
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
            {formatCurrency(summary?.todayAvgPerTransaction ?? 0)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon />
              {t.dashboard.perTransaction}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {formatCurrency(summary?.todayAvgPerTransaction ?? 0)} {t.dashboard.perTransaction}{" "}
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

function ChartRevenueInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = useState("7d")

  useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const days = timeRange === "30d" ? 30 : 7
  const { data: dailyRevenue } = useDailyRevenue(days)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t.dashboard.revenueChart}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {t.dashboard.revenueChartDescription}
          </span>
          <span className="@[540px]/card:hidden">
            {t.dashboard.last7Days}
          </span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="30d">{t.dashboard.last30Days}</ToggleGroupItem>
            <ToggleGroupItem value="7d">{t.dashboard.last7Days}</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder={t.dashboard.last7Days} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="30d" className="rounded-lg">
                {t.dashboard.last30Days}
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                {t.dashboard.last7Days}
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {dailyRevenue && dailyRevenue.length > 0 ? (
          <ChartContainer
            config={revenueChartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={dailyRevenue}>
              <defs>
                <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-revenue)"
                    stopOpacity={1.0}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-revenue)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
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
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value + "T00:00:00").toLocaleDateString("id-ID", {
                        month: "short",
                        day: "numeric",
                      })
                    }}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="revenue"
                type="natural"
                fill="url(#fillRevenue)"
                stroke="var(--color-revenue)"
              />
            </AreaChart>
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

function ChartPaymentDonut() {
  const { data: paymentStats } = usePaymentMethodStats()

  const paymentData = useMemo(() => {
    if (!paymentStats) return []
    return paymentStats.map((s) => ({
      method: s.method,
      total: s.total,
      count: s.count,
      fill: `var(--color-${s.method})`,
    }))
  }, [paymentStats])

  const paymentTotal = useMemo(() => {
    return paymentData.reduce((sum, item) => sum + item.total, 0)
  }, [paymentData])

  const topPaymentMethod = useMemo(() => {
    if (!paymentData.length) return null
    const top = paymentData.reduce((a, b) => (a.total > b.total ? a : b))
    const config = paymentChartConfig[top.method as keyof typeof paymentChartConfig]
    const pct = paymentTotal > 0 ? ((top.total / paymentTotal) * 100).toFixed(0) : "0"
    return { label: config?.label ?? top.method, pct }
  }, [paymentData, paymentTotal])

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>{t.dashboard.paymentMethods}</CardTitle>
        <CardDescription>{t.dashboard.todayBreakdown}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        {paymentData.length > 0 ? (
          <ChartContainer
            config={paymentChartConfig}
            className="mx-auto aspect-square max-h-[250px]"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <Pie
                data={paymentData}
                dataKey="total"
                nameKey="method"
                innerRadius={60}
                strokeWidth={5}
              />
            </PieChart>
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
                    {formatCurrency(p.totalRevenue)}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.dashboard.receipt}</TableHead>
              <TableHead className="text-right">{t.dashboard.amount}</TableHead>
              <TableHead>{t.dashboard.cashier}</TableHead>
              <TableHead className="text-right">{t.dashboard.time}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTx && recentTx.length > 0 ? (
              recentTx.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-medium">
                    {tx.receiptNumber}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(tx.totalAmount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {tx.cashierName}
                      <Badge variant="outline">{tx.paymentMethod}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatTime(tx.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
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
      <div className="px-4 lg:px-6">
        <ChartRevenueInteractive />
      </div>
      <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-3 lg:px-6">
        <ChartPaymentDonut />
        <TopProductsTable />
        <LowStockTable />
      </div>
      <div className="px-4 lg:px-6">
        <RecentTransactionsTable />
      </div>
    </div>
  )
}
