import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowUpDown, FilterX, RefreshCw } from "lucide-react"
import { Button, Skeleton, Spinner } from "@heroui/react"
import { SubpageHeader } from "@/components/layout/subpage-header"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { OptionSelect } from "@/components/option-select"
import { StatCard } from "@/components/stat-card"
import { DateRangePicker } from "@/components/date-range-picker"
import { id as i18n } from "@/i18n/id"
import { usePpobMutasi, usePpobSaldo } from "../../hooks"
import { formatRupiah } from "@/lib/format"
import { useLocalDateRange } from "../history/use-local-date-range"
import type { MutasiItem } from "../../types"
import { MutasiDetailDialog } from "./mutasi-detail-dialog"
import { MutasiTable } from "./mutasi-table"
import { narrowTopupsToRange, summarizeMutasi } from "./mutasi-utils"
import { PpobSetupAction } from "../ppob-setup-action"

/** "+Rp 5.000" / "-Rp 5.000"; nol ditulis "Rp 0" tanpa tanda, karena memang tidak ada yang berpindah. */
function signedRupiah(amount: number, sign: "+" | "-"): string {
  return amount > 0 ? `${sign}${formatRupiah(amount)}` : formatRupiah(amount)
}

const TYPE_FILTER_OPTIONS = [
  { key: "all", label: i18n.ppob.mutasiAll },
  { key: "in", label: i18n.ppob.mutasiIn },
  { key: "out", label: i18n.ppob.mutasiOut },
] as const

export function PpobMutasi() {
  const navigate = useNavigate()
  const { data: saldoData, isLoading: saldoLoading } = usePpobSaldo()

  const [typeFilter, setTypeFilter] = useState("all")
  const [selectedItem, setSelectedItem] = useState<MutasiItem | null>(null)
  const { dateRange, setDateRange, startDate, endDate } = useLocalDateRange()

  const { data: items, isLoading, error, refetch, isFetching } = usePpobMutasi(startDate, endDate)

  // The backend cannot date-filter topups; see `narrowTopupsToRange`.
  const { items: dateFilteredItems, undatedIn } = useMemo(
    () => narrowTopupsToRange(items ?? [], startDate, endDate),
    [items, startDate, endDate],
  )

  const filteredItems = useMemo(() => {
    if (typeFilter === "all") return dateFilteredItems
    return dateFilteredItems.filter((item) => item.mutationType === typeFilter)
  }, [dateFilteredItems, typeFilter])

  const summary = useMemo(() => summarizeMutasi(dateFilteredItems), [dateFilteredItems])
  // Mutasi yang gagal dimuat bukan mutasi nol: "+Rp 0" hijau di samping pesan
  // "Gagal memuat mutasi" menyatakan angka yang tidak diketahui. Seperti kartu
  // saldo di sebelahnya, angkanya "—" sampai datanya benar-benar ada.
  const hasMutasi = items !== undefined

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader
        actions={
          // Tombol ikon `sm tertiary` seperti aksi navbar lain (DESIGN.md §5.1);
          // render-prop `isPending` adalah idiom dokumentasi Button untuk ikon
          // yang berganti spinner.
          <Button
            aria-label={i18n.common.reload}
            isIconOnly
            isPending={isFetching}
            size="sm"
            variant="tertiary"
            onPress={() => refetch()}
          >
            {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />)}
          </Button>
        }
        title={i18n.ppob.mutasiTitle}
        onBack={() => navigate("/ppob")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={i18n.ppob.saldo}
          value={
            saldoLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : saldoData ? (
              formatRupiah(saldoData.saldo)
            ) : (
              "—"
            )
          }
        />
        <StatCard
          label={hasMutasi ? `Total Masuk (${summary.countIn} trx)` : "Total Masuk"}
          tone={hasMutasi && summary.totalIn > 0 ? "success" : "default"}
          value={
            isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : hasMutasi ? (
              signedRupiah(summary.totalIn, "+")
            ) : (
              "—"
            )
          }
        >
          {undatedIn > 0 && (
            <p className="text-xs text-muted">
              Termasuk {undatedIn} topup tanpa tanggal yang tidak bisa disaring
            </p>
          )}
        </StatCard>
        <StatCard
          label={hasMutasi ? `Total Keluar (${summary.countOut} trx)` : "Total Keluar"}
          tone={hasMutasi && summary.totalOut > 0 ? "danger" : "default"}
          value={
            isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : hasMutasi ? (
              signedRupiah(summary.totalOut, "-")
            ) : (
              "—"
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={dateRange} onChange={setDateRange} align="start" />

        <OptionSelect
          aria-label="Filter jenis mutasi"
          className="w-36"
          options={TYPE_FILTER_OPTIONS}
          value={typeFilter}
          onChange={(value) => setTypeFilter(value ?? "all")}
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError
          isRetrying={isFetching}
          secondaryAction={<PpobSetupAction error={error} />}
          title={i18n.loadFailed.ppobMutasi}
          onRetry={() => refetch()}
        >
          {error instanceof Error ? error.message : i18n.common.error}
        </LoadError>
      ) : filteredItems.length === 0 && typeFilter !== "all" && dateFilteredItems.length > 0 ? (
        <NoData
          action={
            <Button size="sm" variant="secondary" onPress={() => setTypeFilter("all")}>
              Tampilkan semua
            </Button>
          }
          icon={<FilterX />}
          title={`Tidak ada mutasi ${typeFilter === "in" ? "masuk" : "keluar"}`}
        >
          Ada {dateFilteredItems.length} mutasi lain pada rentang tanggal ini.
        </NoData>
      ) : filteredItems.length === 0 ? (
        <NoData icon={<ArrowUpDown />} title={i18n.ppob.mutasiNoData}>
          Tidak ada mutasi pada rentang tanggal yang dipilih.
        </NoData>
      ) : (
        <MutasiTable items={filteredItems} onSelect={setSelectedItem} />
      )}

      {selectedItem && (
        <MutasiDetailDialog
          item={selectedItem}
          open={!!selectedItem}
          onOpenChange={(open) => {
            if (!open) setSelectedItem(null)
          }}
        />
      )}
    </div>
  )
}
