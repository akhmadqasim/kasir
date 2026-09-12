import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowDownCircle, ArrowUpCircle, Search, RefreshCw } from "lucide-react"
import { Button, Label, ListBox, Modal, Select, Separator, Skeleton } from "@heroui/react"
import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import { DateRangePicker } from "@/components/date-range-picker"
import { selectedText } from "@/components/selected-text"
import type { DateRange } from "@/lib/date-range"
import { id as i18n } from "@/i18n/id"
import { usePpobMutasi, usePpobSaldo } from "../../hooks"
import { formatRupiah, toLocalDateString } from "@/lib/format"
import {
  getDefaultDateRange,
  getDefaultDateRangeDates,
  isWithinLocalDateRange,
  normalizeStatus,
  parseMutasiDate,
  formatDateTime,
} from "../history/history-utils"
import type { MutasiItem } from "../../types"

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: i18n.ppob.mutasiAll },
  { value: "in", label: i18n.ppob.mutasiIn },
  { value: "out", label: i18n.ppob.mutasiOut },
] as const

const DISPLAY_LABELS: Record<string, string> = {
  trxid: "ID Transaksi",
  trx_id: "ID Transaksi",
  status: "Status",
  total: "Total",
  amount: "Nominal",
  amount_fee: "Biaya Admin",
  admin_fee: "Biaya Admin",
  fee: "Biaya",
  sell_price: "Harga Jual",
  base_price: "Harga Modal",
  vendor_price: "Harga Vendor",
  profit: "Keuntungan",
  created_at: "Tanggal",
  formatted_date: "Tanggal",
  product_name: "Produk",
  plu_desc: "Deskripsi",
  igr_desc: "Deskripsi",
  description: "Keterangan",
  target: "Tujuan",
  customer_no: "No. Pelanggan",
  raw_paymentcode: "Kode Bayar",
  phone_number: "No. HP",
  token_number: "Token",
  serial_number: "No. Seri",
  no_ref: "No. Referensi",
  provider: "Penyedia",
  merchant: "Merchant",
  channel: "Kanal",
  payment_method: "Metode Bayar",
  payment_code: "Kode Pembayaran",
  denom: "Denominasi",
  bank: "Bank",
  nominal: "Nominal",
  kwh: "KWH",
  type: "Tipe",
  topup_amount: "Jumlah Topup",
  topup_method: "Metode Topup",
  balance: "Saldo",
  prev_balance: "Saldo Sebelumnya",
  last_balance: "Saldo Terakhir",
  expire_at: "Kedaluwarsa",
  expired_at: "Kedaluwarsa",
  merchant_name: "Nama Merchant",
  processed_at: "Diproses",
  trx_reference: "No. Referensi",
  trx_ref: "No. Referensi",
  updated_at: "Diperbarui",
  sender: "Pengirim",
  receiver: "Penerima",
  note: "Catatan",
  notes: "Catatan",
  remark: "Keterangan",
  reason: "Alasan",
}

// Fields to hide from detail view (verbose/internal)
const HIDDEN_KEYS = new Set([
  "device_id",
  "inquiry_id",
  "plu",
  "igr_plu",
  "plu_igr",
  "margin",
  "receipt_text",
  "invoice_url",
  "invoice_string",
  "id",
  "max_adjustment",
  "advice_id",
  "ref_id",
  "amount_base_price",
  "complaint",
  "uid",
  "user_id",
  "flag_member",
  "member_id",
  "flag_topup",
  "topup_type",
  "type_topup",
])

// Fields to show first (priority order)
const PRIORITY_KEYS = [
  "created_at",
  "formatted_date",
  "product_name",
  "plu_desc",
  "igr_desc",
  "description",
  "target",
  "raw_paymentcode",
  "customer_no",
  "phone_number",
  "total",
  "amount",
  "sell_price",
  "amount_fee",
  "admin_fee",
  "fee",
  "base_price",
  "vendor_price",
  "profit",
  "token_number",
  "serial_number",
  "kwh",
  "no_ref",
  "trxid",
  "trx_id",
  "provider",
  "merchant",
  "denom",
  "payment_code",
  "status",
]

function formatRawValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "object") return null

  const str = String(value)
  if (str === "-" || str === "0" || str === "0.0" || str.trim() === "") return null

  const numKeys = [
    "total",
    "amount",
    "amount_fee",
    "admin_fee",
    "fee",
    "sell_price",
    "base_price",
    "vendor_price",
    "profit",
    "nominal",
    "topup_amount",
  ]
  if (numKeys.includes(key) && !isNaN(Number(value))) {
    return formatRupiah(Number(value))
  }

  return str
}

function MutasiDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MutasiItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isIn = item.mutationType === "in"
  const raw = item.rawData as Record<string, unknown>

  // Build ordered rows: priority keys first, then remaining
  const seenKeys = new Set<string>()
  const seenLabels = new Set<string>()
  const detailRows: { label: string; value: string }[] = []

  const addRow = (key: string, val: unknown) => {
    if (HIDDEN_KEYS.has(key) || seenKeys.has(key)) return
    seenKeys.add(key)
    const formatted = formatRawValue(key, val)
    if (!formatted) return
    const label =
      DISPLAY_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    // Deduplicate by label — keep only first occurrence of each label
    if (seenLabels.has(label)) return
    seenLabels.add(label)
    detailRows.push({ label, value: formatted })
  }

  for (const key of PRIORITY_KEYS) {
    if (raw[key] !== undefined) addRow(key, raw[key])
  }

  // Remaining keys not in priority list
  for (const [key, val] of Object.entries(raw)) {
    addRow(key, val)
  }

  const heading = isIn ? i18n.ppob.mutasiTopup : i18n.ppob.mutasiPayment

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={heading}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon
              className={
                isIn
                  ? "bg-success-soft text-success-soft-foreground"
                  : "bg-danger-soft text-danger-soft-foreground"
              }
            >
              {isIn ? <ArrowDownCircle className="size-5" /> : <ArrowUpCircle className="size-5" />}
            </Modal.Icon>
            <Modal.Heading>{heading}</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <div className="flex items-center justify-between">
              <span
                className={`text-xl font-semibold tracking-tight tabular-nums ${isIn ? "text-success" : "text-danger"}`}
              >
                {isIn ? "+" : "-"}
                {item.amount != null ? formatRupiah(item.amount) : "-"}
              </span>
              <MutasiStatusBadge status={item.status} />
            </div>

            <Separator />

            {/* The container's default `scroll="inside"` already caps the dialog
                height and scrolls the body, so no scroll box of its own here. */}
            <SummaryList items={detailRows} layout="grid" />
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Tutup
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

/** Status vendor yang tidak dikenal ditampilkan apa adanya, bukan disembunyikan. */
function MutasiStatusBadge({ status, size }: { status: string | null; size?: "sm" }) {
  switch (normalizeStatus(status)) {
    case "sukses":
      return (
        <StatusBadge status="success" size={size}>
          Sukses
        </StatusBadge>
      )
    case "gagal":
      return (
        <StatusBadge status="error" size={size}>
          Gagal
        </StatusBadge>
      )
    case "proses":
      return (
        <StatusBadge status="warning" size={size}>
          Proses
        </StatusBadge>
      )
    default:
      return (
        <StatusBadge status="neutral" size={size}>
          {status ?? "-"}
        </StatusBadge>
      )
  }
}

function MutasiRow({ item, onPress }: { item: MutasiItem; onPress: () => void }) {
  const isIn = item.mutationType === "in"

  return (
    <Button
      fullWidth
      className="h-auto justify-start gap-3 p-3 text-left"
      variant="secondary"
      onPress={onPress}
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          isIn ? "bg-success-soft" : "bg-danger-soft"
        }`}
      >
        {isIn ? (
          <ArrowDownCircle className="size-5 text-success" />
        ) : (
          <ArrowUpCircle className="size-5 text-danger" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {item.description ?? (isIn ? i18n.ppob.mutasiTopup : i18n.ppob.mutasiPayment)}
          </span>
          <MutasiStatusBadge size="sm" status={item.status} />
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span>{formatDateTime(item.createdAt)}</span>
          {item.reference && (
            <>
              <span>·</span>
              <span className="truncate">{item.reference}</span>
            </>
          )}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className={`block text-sm font-semibold ${isIn ? "text-success" : "text-danger"}`}>
          {isIn ? "+" : "-"}
          {item.amount != null ? formatRupiah(item.amount) : "-"}
        </span>
        {item.paymentMethod && (
          <span className="block text-xs text-muted">{item.paymentMethod}</span>
        )}
      </span>
    </Button>
  )
}

export function PpobMutasi() {
  const navigate = useNavigate()
  const defaults = getDefaultDateRange()
  const { data: saldoData } = usePpobSaldo()

  const [typeFilter, setTypeFilter] = useState("all")
  const [selectedItem, setSelectedItem] = useState<MutasiItem | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRangeDates)

  // The picker holds local dates; `toISOString()` here would send yesterday.
  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : defaults.start
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : defaults.end

  const { data: items, isLoading, error, refetch, isFetching } = usePpobMutasi(startDate, endDate)

  /**
   * Topups are not date-filtered by the backend and cannot be.
   *
   * `ppob_get_mutasi` sends the range to `history-payment`, but the vendor's
   * `topup/history` takes only a `device_id` — the OpenAPI contract has no date
   * parameters at all — so it always answers with the account's whole topup
   * history. Every `in` row therefore has to be narrowed here, or "Total Masuk"
   * reports every topup ever made regardless of the range on screen.
   */
  const { dateFilteredItems, undatedIn } = useMemo(() => {
    if (!items) return { dateFilteredItems: [], undatedIn: 0 }

    const kept = []
    let undated = 0
    for (const item of items) {
      if (item.mutationType !== "in") {
        kept.push(item)
        continue
      }
      if (isWithinLocalDateRange(item.createdAt, startDate, endDate)) {
        kept.push(item)
      } else if (!parseMutasiDate(item.createdAt)) {
        // Cannot be placed in or out of the range. Keep it visible and say so
        // rather than dropping money off the screen without a word.
        kept.push(item)
        undated++
      }
    }
    return { dateFilteredItems: kept, undatedIn: undated }
  }, [items, startDate, endDate])

  const filteredItems = useMemo(() => {
    if (typeFilter === "all") return dateFilteredItems
    return dateFilteredItems.filter((item) => item.mutationType === typeFilter)
  }, [dateFilteredItems, typeFilter])

  const summary = useMemo(() => {
    return dateFilteredItems.reduce(
      (acc, item) => {
        const amount = item.amount ?? 0
        const isSuccess = normalizeStatus(item.status) === "sukses"
        if (item.mutationType === "in" && isSuccess) {
          acc.totalIn += amount
          acc.countIn++
        } else if (item.mutationType === "out" && isSuccess) {
          acc.totalOut += amount
          acc.countOut++
        }
        return acc
      },
      { totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 },
    )
  }, [dateFilteredItems])

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader
        actions={
          <PendingButton
            isPending={isFetching}
            size="sm"
            variant="tertiary"
            onPress={() => refetch()}
          >
            <RefreshCw />
            Refresh
          </PendingButton>
        }
        title={i18n.ppob.mutasiTitle}
        onBack={() => navigate("/ppob")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={i18n.ppob.saldo} value={saldoData ? formatRupiah(saldoData.saldo) : "-"} />
        <StatCard
          label={`Total Masuk (${summary.countIn} trx)`}
          tone="success"
          value={`+${formatRupiah(summary.totalIn)}`}
        >
          {undatedIn > 0 && (
            <p className="text-xs text-muted">
              Termasuk {undatedIn} topup tanpa tanggal yang tidak bisa disaring
            </p>
          )}
        </StatCard>
        <StatCard
          label={`Total Keluar (${summary.countOut} trx)`}
          tone="danger"
          value={`-${formatRupiah(summary.totalOut)}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} align="start" />

        <Select
          aria-label="Filter jenis mutasi"
          className="w-36"
          value={typeFilter}
          onChange={(value) => setTypeFilter(String(value))}
        >
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {TYPE_FILTER_OPTIONS.map((opt) => (
                <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                  <Label>{opt.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <NoData title="Gagal memuat mutasi" tone="danger">
          {error instanceof Error ? error.message : i18n.common.error}
        </NoData>
      ) : filteredItems.length === 0 ? (
        <NoData icon={<Search />} title={i18n.ppob.mutasiNoData}>
          Tidak ditemukan mutasi pada rentang tanggal yang dipilih
        </NoData>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredItems.map((item, index) => (
            <MutasiRow key={item.id ?? index} item={item} onPress={() => setSelectedItem(item)} />
          ))}
        </div>
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
