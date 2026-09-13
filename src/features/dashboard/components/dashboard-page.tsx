import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Tabs } from "@heroui/react"
import { RefreshCwIcon } from "lucide-react"

import { queryKeys } from "@/lib/api/query-keys"
import { DashboardHeader } from "./dashboard-header"
import { LowStockTable } from "./low-stock-table"
import { PaymentBreakdownTable } from "./payment-breakdown-table"
import { PaymentTrendChart } from "./payment-trend-chart"
import { RecentTransactionsTable } from "./recent-transactions-table"
import { RevenueChart } from "./revenue-chart"
import { SummaryCards } from "./summary-cards"
import { daysForRange, type TimeRangeKey } from "./time-range"
import { TimeRangeMenu } from "./time-range-menu"
import { TopProductsTable } from "./top-products-table"

/**
 * Tiga bagian dashboard, dipisah menurut pertanyaan yang dijawabnya:
 * bagaimana hari ini berjalan, apa yang laku, dan apa yang perlu dibeli lagi.
 */
const TABS = [
  { id: "overview", label: "Ringkasan" },
  { id: "sales", label: "Penjualan" },
  { id: "stock", label: "Stok" },
] as const

type DashboardTab = (typeof TABS)[number]["id"]

/**
 * Layar pertama yang dibuka kasir setiap pagi.
 *
 * Dulu satu halaman panjang berisi sembilan kartu sekaligus: empat KPI, kartu
 * aksi cepat, grafik, tiga tabel, lalu tabel transaksi. Menggulung sejauh itu
 * untuk mencari stok yang menipis bukan pekerjaan yang wajar dilakukan setiap
 * hari, jadi isinya dipecah jadi tiga tab dan aksinya naik ke kepala halaman.
 *
 * Rentang waktunya hanya digambar pada tab Ringkasan, satu-satunya tab yang
 * berisi deret waktu. Kontrol yang tidak berpengaruh lebih membingungkan
 * daripada kontrol yang hilang.
 */
export function DashboardPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<DashboardTab>("overview")
  const [range, setRange] = useState<TimeRangeKey>("7d")
  const days = daysForRange(range)

  return (
    // Dipusatkan dengan lebar maksimum, seperti template dashboard HeroUI. Layar
    // kasir sengaja tidak — ia butuh seluruh lebar untuk keranjang dan katalog.
    <div className="flex w-full flex-col gap-4">
      <DashboardHeader />

      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as DashboardTab)}>
        {/* Baris kendali template: tab di kiri; di kanan tombol muat-ulang lalu
            pemilih periode, semuanya ukuran `sm`. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Bagian dashboard">
              {TABS.map((item) => (
                <Tabs.Tab key={item.id} id={item.id}>
                  {item.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              isIconOnly
              aria-label="Muat ulang data"
              size="sm"
              variant="tertiary"
              onPress={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
              }}
            >
              <RefreshCwIcon />
            </Button>
            {tab === "overview" ? <TimeRangeMenu value={range} onChange={setRange} /> : null}
          </div>
        </div>

        <Tabs.Panel className="flex flex-col gap-4" id="overview">
          <SummaryCards />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RevenueChart days={days} />
            <PaymentTrendChart days={days} />
          </div>
          <RecentTransactionsTable />
        </Tabs.Panel>

        <Tabs.Panel className="grid grid-cols-1 gap-4 xl:grid-cols-2" id="sales">
          <TopProductsTable />
          <PaymentBreakdownTable />
        </Tabs.Panel>

        <Tabs.Panel id="stock">
          <LowStockTable />
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}
