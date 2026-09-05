import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  Select,
  Table,
} from "@heroui/react"
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
import { selectedText } from "@/components/selected-text"
import { StatusBadge } from "@/components/status-badge"
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
import {
  paymentMethodLabel,
  transactionStatusLabel,
  transactionStatusVariant,
} from "@/lib/labels"

// --- Helpers ---

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value)
}

/**
 * Gradasi tipis khas kartu KPI.
 *
 * Dulu dipasang dari grid induk lewat `*:data-[slot=card]`, atribut yang hanya
 * ada di Card shadcn. HeroUI tidak menandai kartunya, jadi kelasnya ditempel
 * langsung ke tiap kartu. `dark:bg-card` lama ikut hilang karena Card HeroUI
 * sudah memakai `bg-surface` — nilai yang sama dengan `--card`.
 */
const STAT_CARD_CLASS =
  "@container/card bg-gradient-to-t from-accent/5 to-surface shadow-xs"

const STAT_VALUE_CLASS =
  "text-2xl font-semibold tabular-nums @[250px]/card:text-3xl"

/** Baris kosong tabel dashboard: satu pesan, bukan sel ber-`colSpan`. */
function renderNoData() {
  return <p className="py-6 text-center text-muted">{t.dashboard.noData}</p>
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

const TIME_RANGE_OPTIONS = [
  { key: "1y", label: t.dashboard.last1Year, days: 365 },
  { key: "6m", label: t.dashboard.last6Months, days: 180 },
  { key: "3m", label: t.dashboard.last3Months, days: 90 },
  { key: "1m", label: t.dashboard.last1Month, days: 30 },
  { key: "7d", label: t.dashboard.last1Week, days: 7 },
] as const

// --- Sub-components ---

/**
 * Kepala kartu KPI: label kecil, angka besar, lencana tren di kanan.
 *
 * Card HeroUI tidak punya padanan `CardAction`, jadi lencananya dibariskan
 * dengan deskripsi supaya urutan bacanya tetap label → tren → angka.
 */
function StatCardHeader({
  description,
  value,
  badge,
}: {
  description: string
  value: string
  badge?: ReactNode
}) {
  return (
    <Card.Header className="gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <Card.Description>{description}</Card.Description>
        {badge}
      </div>
      <Card.Title className={STAT_VALUE_CLASS}>{value}</Card.Title>
    </Card.Header>
  )
}

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
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <Card className={STAT_CARD_CLASS}>
        <StatCardHeader
          description={t.dashboard.todayRevenue}
          value={formatRupiah(summary?.todayRevenue ?? 0)}
          badge={
            <Chip size="sm">
              {isUp ? (
                <TrendingUpIcon className="size-3" />
              ) : (
                <TrendingDownIcon className="size-3" />
              )}
              <Chip.Label>
                {isUp ? "+" : ""}{revenueChange.toFixed(1)}%
              </Chip.Label>
            </Chip>
          }
        />
        <Card.Footer className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {isUp ? t.dashboard.trendUp : t.dashboard.trendDown} {Math.abs(revenueChange).toFixed(1)}% {t.dashboard.vsYesterday}{" "}
            {isUp ? (
              <TrendingUpIcon className="size-4" />
            ) : (
              <TrendingDownIcon className="size-4" />
            )}
          </div>
          <div className="text-muted">
            {t.dashboard.revenueChartDescription}
          </div>
        </Card.Footer>
      </Card>
      <Card className={STAT_CARD_CLASS}>
        <StatCardHeader
          description={t.dashboard.grossProfit}
          value={formatRupiah(summary?.todayGrossProfit ?? 0)}
          badge={
            <Chip size="sm">
              <TrendingUpIcon className="size-3" />
              <Chip.Label>{marginPct.toFixed(1)}%</Chip.Label>
            </Chip>
          }
        />
        <Card.Footer className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Margin {marginPct.toFixed(1)}% dari penjualan{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted">
            {t.dashboard.todayRevenue}
          </div>
        </Card.Footer>
      </Card>
      <Card className={STAT_CARD_CLASS}>
        <StatCardHeader
          description={t.dashboard.todayTransactions}
          value={formatNumber(summary?.todayTransactions ?? 0)}
          badge={
            <Chip size="sm">
              <TrendingUpIcon className="size-3" />
              <Chip.Label>{t.dashboard.completedTransactions}</Chip.Label>
            </Chip>
          }
        />
        <Card.Footer className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {formatNumber(summary?.todayTransactions ?? 0)} {t.dashboard.completedTransactions}{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted">
            {t.dashboard.todayBreakdown}
          </div>
        </Card.Footer>
      </Card>
      <Card className={STAT_CARD_CLASS}>
        <StatCardHeader
          description={t.dashboard.avgPerTransaction}
          value={formatRupiah(summary?.todayAvgPerTransaction ?? 0)}
        />
        <Card.Footer className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {formatRupiah(summary?.todayAvgPerTransaction ?? 0)} {t.dashboard.perTransaction}{" "}
            <TrendingUpIcon className="size-4" />
          </div>
          <div className="text-muted">
            {t.dashboard.todayBreakdown}
          </div>
        </Card.Footer>
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
      onPress: () => navigate("/cashier"),
      label: "Mulai Penjualan",
      variant: "primary" as const,
      visible: true,
      loading: false,
    },
    {
      title: "Lihat riwayat transaksi",
      description: "Cek transaksi terbaru, pembayaran, dan detail struk.",
      icon: <HistoryIcon className="h-4 w-4" />,
      onPress: () => navigate("/transactions"),
      label: "Riwayat Transaksi",
      variant: "outline" as const,
      visible: true,
      loading: false,
    },
    {
      title: "Kelola produk",
      description: "Tambah, ubah, dan cek stok produk toko.",
      icon: <PackageIcon className="h-4 w-4" />,
      onPress: () => navigate("/products"),
      label: "Kelola Produk",
      variant: "outline" as const,
      visible: isAdmin,
      loading: false,
    },
    {
      title: "Backup data sekarang",
      description: "Buat backup manual sebelum update atau perubahan besar.",
      icon: <DatabaseBackupIcon className="h-4 w-4" />,
      onPress: () => createBackupMutation.mutate(),
      label: createBackupMutation.isPending ? "Membuat Backup..." : "Backup Sekarang",
      variant: "outline" as const,
      visible: isAdmin,
      loading: createBackupMutation.isPending,
    },
  ].filter((action) => action.visible)

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <Card.Header>
          <Card.Title>Aksi Cepat</Card.Title>
          <Card.Description>
            Buka area kerja utama tanpa harus berpindah-pindah menu.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {actions.map((action) => (
              // Tombol HeroUI dikunci `h-10 md:h-9 w-fit whitespace-nowrap`,
              // jadi kartu aksi ini harus melepas ketiganya secara eksplisit.
              <Button
                key={action.title}
                className="h-auto min-h-28 w-full flex-col items-start justify-start gap-2 rounded-2xl px-4 py-4 text-left whitespace-normal md:h-auto"
                isDisabled={action.loading}
                variant={action.variant}
                onPress={action.onPress}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {action.icon}
                  {action.label}
                </span>
                <span className="text-base leading-tight font-semibold">
                  {action.title}
                </span>
                <span
                  className={`text-xs leading-relaxed ${
                    action.variant === "primary" ? "opacity-80" : "text-muted"
                  }`}
                >
                  {action.description}
                </span>
              </Button>
            ))}
          </div>
        </Card.Content>
      </Card>
    </div>
  )
}

function ChartRevenueInteractive() {
  const [timeRange, setTimeRange] = useState<string>("7d")

  const days =
    TIME_RANGE_OPTIONS.find((option) => option.key === timeRange)?.days ?? 7
  const { data: dailyRevenue } = useDailyRevenue(days)

  const totalRevenue = useMemo(() => {
    if (!dailyRevenue) return 0
    return dailyRevenue.reduce((acc, curr) => acc + curr.revenue, 0)
  }, [dailyRevenue])

  const totalTransactions = useMemo(() => {
    if (!dailyRevenue) return 0
    return dailyRevenue.reduce((acc, curr) => acc + curr.transactions, 0)
  }, [dailyRevenue])

  // Kepala kartu ini penuh sampai tepi (ada garis pemisah antar angka), jadi
  // padding bawaan Card dilepas. `overflow-hidden` mengganti `overflow-visible`
  // bawaan HeroUI supaya garisnya terpotong rapi di sudut membulat.
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <Card.Header className="flex flex-col items-stretch border-b sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-0">
          <Card.Title>{t.dashboard.revenueChart}</Card.Title>
          <Card.Description>
            {t.dashboard.revenueChartDescription}
          </Card.Description>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted">
              {t.dashboard.revenue}
            </span>
            <span className="text-lg leading-none font-bold sm:text-3xl">
              {formatRupiah(totalRevenue)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted">
              {t.dashboard.transactions}
            </span>
            <span className="text-lg leading-none font-bold sm:text-3xl">
              {formatNumber(totalTransactions)}
            </span>
          </div>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4 px-2 py-4 sm:px-6 sm:py-6">
        <Select
          aria-label="Rentang waktu grafik"
          className="w-40 sm:ml-auto"
          placeholder={t.dashboard.last1Week}
          value={timeRange}
          onChange={(value) => setTimeRange(String(value))}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {TIME_RANGE_OPTIONS.map((option) => (
                <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
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
          <div className="flex h-[250px] items-center justify-center text-muted">
            {t.dashboard.noData}
          </div>
        )}
      </Card.Content>
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
    <Card>
      <Card.Header className="items-center">
        <Card.Title>{t.dashboard.paymentMethods}</Card.Title>
        <Card.Description>{t.dashboard.todayBreakdown}</Card.Description>
      </Card.Header>
      <Card.Content className="flex-1">
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
          <div className="flex h-[250px] items-center justify-center text-muted">
            {t.dashboard.noData}
          </div>
        )}
      </Card.Content>
      <Card.Footer className="flex-col gap-2 text-sm">
        {topPaymentMethod ? (
          <>
            <div className="flex items-center gap-2 leading-none font-medium">
              {topPaymentMethod.label} {t.dashboard.dominates} ({topPaymentMethod.pct}%)
              <TrendingUpIcon className="h-4 w-4" />
            </div>
            <div className="leading-none text-muted">
              {t.dashboard.todayBreakdown}
            </div>
          </>
        ) : (
          <div className="leading-none text-muted">
            {t.dashboard.noData}
          </div>
        )}
      </Card.Footer>
    </Card>
  )
}

function TopProductsTable() {
  const { data: topProducts } = useTopProducts(5)

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t.dashboard.topProducts}</Card.Title>
      </Card.Header>
      <Card.Content>
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label={t.dashboard.topProducts}>
              <Table.Header>
                <Table.Column isRowHeader>{t.dashboard.productName}</Table.Column>
                <Table.Column className="text-right">{t.dashboard.qtySold}</Table.Column>
                <Table.Column className="text-right">{t.dashboard.totalRevenue}</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={renderNoData}>
                {(topProducts ?? []).map((p) => (
                  <Table.Row key={p.productId} id={p.productId} textValue={p.productName}>
                    <Table.Cell className="max-w-[150px] truncate font-medium">
                      {p.productName}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatNumber(p.totalQty)}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatRupiah(p.totalRevenue)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
    </Card>
  )
}

function LowStockTable() {
  const { data: lowStock } = useLowStockProducts()

  return (
    <Card>
      <Card.Header>
        <Card.Title className="flex items-center gap-2">
          <AlertTriangleIcon className="size-4" />
          {t.dashboard.lowStock}
        </Card.Title>
      </Card.Header>
      <Card.Content>
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label={t.dashboard.lowStock}>
              <Table.Header>
                <Table.Column isRowHeader>{t.dashboard.product}</Table.Column>
                <Table.Column className="text-right">{t.dashboard.stock}</Table.Column>
                <Table.Column className="text-right">{t.dashboard.minStock}</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={renderNoData}>
                {(lowStock ?? []).map((p) => (
                  <Table.Row key={p.id} id={p.id} textValue={p.name}>
                    <Table.Cell className="max-w-[150px] truncate font-medium">
                      {p.name}
                    </Table.Cell>
                    {/*
                      Setiap baris di sini sudah di bawah `min_stock`, jadi statusnya
                      peringatan; stok nol sudah kehabisan dan diberi warna error.
                    */}
                    <Table.Cell className="text-right">
                      <StatusBadge size="sm" status={p.stock === 0 ? "error" : "warning"}>
                        {p.stock} {p.unit}
                      </StatusBadge>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums text-muted">
                      {p.minStock} {p.unit}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
    </Card>
  )
}

function RecentTransactionsTable() {
  const { data: recentTx } = useRecentTransactions()

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t.dashboard.recentTransactions}</Card.Title>
      </Card.Header>
      <Card.Content>
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content
              aria-label={t.dashboard.recentTransactions}
              className="min-w-[720px]"
            >
              <Table.Header>
                <Table.Column isRowHeader>{t.dashboard.receipt}</Table.Column>
                <Table.Column>{t.dashboard.cashier}</Table.Column>
                <Table.Column>Metode</Table.Column>
                <Table.Column>Tanggal</Table.Column>
                <Table.Column className="text-center">Item</Table.Column>
                <Table.Column className="text-right">{t.dashboard.amount}</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={renderNoData}>
                {(recentTx ?? []).map((tx) => (
                  <Table.Row key={tx.id} id={tx.id} textValue={tx.receiptNumber}>
                    <Table.Cell className="font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{tx.receiptNumber}</span>
                        {/*
                          `query_recent_transactions` filters out deleted, refunded and
                          unfulfilled PPOB rows, so only `completed` and
                          `partial_refund` reach here. The partial ones still show their
                          full original amount, which is the one case worth flagging.
                        */}
                        {tx.status !== "completed" && (
                          <StatusBadge size="sm" status={transactionStatusVariant(tx.status)}>
                            {transactionStatusLabel(tx.status)}
                          </StatusBadge>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>{tx.cashierName}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm">{paymentMethodLabel(tx.paymentMethod)}</Chip>
                    </Table.Cell>
                    <Table.Cell className="text-muted">{formatDateTime(tx.createdAt)}</Table.Cell>
                    <Table.Cell className="text-center tabular-nums">{tx.totalItems}</Table.Cell>
                    <Table.Cell className="text-right font-medium tabular-nums">
                      {formatRupiah(tx.totalAmount)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
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
