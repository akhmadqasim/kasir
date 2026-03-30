import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  Search,
  RefreshCw,
  Loader2,
  CalendarIcon,
} from "lucide-react"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { id as i18n } from "@/i18n/id"
import { usePpobMutasi, usePpobSaldo } from "../../hooks"
import { getDefaultDateRange, normalizeStatus, formatRupiah, formatDateTime } from "../history/history-utils"
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
  "device_id", "inquiry_id", "plu", "igr_plu", "plu_igr", "margin",
  "receipt_text", "invoice_url", "invoice_string",
  "id", "max_adjustment", "advice_id", "ref_id",
  "amount_base_price", "complaint", "uid", "user_id", "flag_member",
  "member_id", "flag_topup", "topup_type", "type_topup",
])

// Fields to show first (priority order)
const PRIORITY_KEYS = [
  "created_at", "formatted_date",
  "product_name", "plu_desc", "igr_desc", "description",
  "target", "raw_paymentcode", "customer_no", "phone_number",
  "total", "amount", "sell_price",
  "amount_fee", "admin_fee", "fee",
  "base_price", "vendor_price", "profit",
  "token_number", "serial_number", "kwh",
  "no_ref", "trxid", "trx_id",
  "provider", "merchant", "denom",
  "payment_code", "status",
]

function formatRawValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "object") return null

  const str = String(value)
  if (str === "-" || str === "0" || str === "0.0" || str.trim() === "") return null

  const numKeys = ["total", "amount", "amount_fee", "admin_fee", "fee", "sell_price", "base_price", "vendor_price", "profit", "nominal", "topup_amount"]
  if (numKeys.includes(key) && !isNaN(Number(value))) {
    return formatRupiah(Number(value))
  }

  return str
}

function MutasiDetailDialog({ item, open, onOpenChange }: {
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
    const label = DISPLAY_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isIn ? (
              <ArrowDownCircle className="h-5 w-5 text-green-600" />
            ) : (
              <ArrowUpCircle className="h-5 w-5 text-red-600" />
            )}
            {isIn ? i18n.ppob.mutasiTopup : i18n.ppob.mutasiPayment}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className={`text-lg font-bold ${isIn ? "text-green-600" : "text-red-600"}`}>
              {isIn ? "+" : "-"}{item.amount != null ? formatRupiah(item.amount) : "-"}
            </span>
            <Badge variant="outline" className={
              normalizeStatus(item.status) === "sukses"
                ? "border-green-200 bg-green-50 text-green-700"
                : normalizeStatus(item.status) === "gagal"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : ""
            }>
              {normalizeStatus(item.status).toUpperCase()}
            </Badge>
          </div>

          <Separator />

          <div className="max-h-[400px] overflow-y-auto space-y-1 pr-1">
            {detailRows.map((row) => (
              <div key={row.label} className="grid grid-cols-[120px_1fr] gap-2 text-sm py-0.5">
                <span className="text-muted-foreground text-xs">{row.label}</span>
                <span className="font-medium break-words">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MutasiRow({ item, onClick }: { item: MutasiItem; onClick: () => void }) {
  const isIn = item.mutationType === "in"
  const status = normalizeStatus(item.status)

  const statusBadge = {
    sukses: <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300 text-xs">Sukses</Badge>,
    gagal: <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300 text-xs">Gagal</Badge>,
    proses: <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300 text-xs">Proses</Badge>,
    unknown: <Badge variant="outline" className="text-xs">{item.status ?? "-"}</Badge>,
  }[status]

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
      onClick={onClick}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
        isIn
          ? "bg-green-100 dark:bg-green-950"
          : "bg-red-100 dark:bg-red-950"
      }`}>
        {isIn ? (
          <ArrowDownCircle className="h-5 w-5 text-green-600" />
        ) : (
          <ArrowUpCircle className="h-5 w-5 text-red-600" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {item.description ?? (isIn ? i18n.ppob.mutasiTopup : i18n.ppob.mutasiPayment)}
          </span>
          {statusBadge}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDateTime(item.createdAt)}</span>
          {item.reference && (
            <>
              <span>·</span>
              <span className="truncate">{item.reference}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <p className={`text-sm font-semibold ${
          isIn ? "text-green-600" : "text-red-600"
        }`}>
          {isIn ? "+" : "-"}{item.amount != null ? formatRupiah(item.amount) : "-"}
        </p>
        {item.paymentMethod && (
          <p className="text-xs text-muted-foreground">{item.paymentMethod}</p>
        )}
      </div>
    </button>
  )
}

export function PpobMutasi() {
  const navigate = useNavigate()
  const defaults = getDefaultDateRange()
  const { data: saldoData } = usePpobSaldo()

  const [typeFilter, setTypeFilter] = useState("all")
  const [selectedItem, setSelectedItem] = useState<MutasiItem | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(defaults.start),
    to: new Date(defaults.end),
  })

  const startDate = dateRange?.from?.toISOString().slice(0, 10) ?? defaults.start
  const endDate = dateRange?.to?.toISOString().slice(0, 10) ?? defaults.end

  const { data: items, isLoading, error, refetch, isFetching } = usePpobMutasi(startDate, endDate)

  const filteredItems = useMemo(() => {
    if (!items) return []
    if (typeFilter === "all") return items
    return items.filter((item) => item.mutationType === typeFilter)
  }, [items, typeFilter])

  const summary = useMemo(() => {
    if (!items) return { totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 }
    return items.reduce(
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
      { totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 }
    )
  }, [items])

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{i18n.ppob.mutasiTitle}</h1>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Saldo + Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{i18n.ppob.saldo}</p>
          <p className="text-xl font-bold">
            {saldoData ? formatRupiah(saldoData.saldo) : "-"}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Masuk ({summary.countIn} trx)</p>
          <p className="text-xl font-bold text-green-600">
            +{formatRupiah(summary.totalIn)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Keluar ({summary.countOut} trx)</p>
          <p className="text-xl font-bold text-red-600">
            -{formatRupiah(summary.totalOut)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              data-empty={!dateRange?.from}
              className="justify-start px-2.5 font-normal data-[empty=true]:text-muted-foreground"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "dd MMM yyyy", { locale: idLocale })}
                    {" - "}
                    {format(dateRange.to, "dd MMM yyyy", { locale: idLocale })}
                  </>
                ) : (
                  format(dateRange.from, "dd MMM yyyy", { locale: idLocale })
                )
              ) : (
                <span>Pilih tanggal</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              locale={idLocale}
            />
          </PopoverContent>
        </Popover>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-destructive font-medium mb-1">Gagal memuat mutasi</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Terjadi kesalahan"}
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium mb-1">{i18n.ppob.mutasiNoData}</p>
          <p className="text-sm text-muted-foreground">
            Tidak ditemukan mutasi pada rentang tanggal yang dipilih
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item, index) => (
            <MutasiRow
              key={item.id ?? index}
              item={item}
              onClick={() => setSelectedItem(item)}
            />
          ))}
        </div>
      )}

      {selectedItem && (
        <MutasiDetailDialog
          item={selectedItem}
          open={!!selectedItem}
          onOpenChange={(open) => { if (!open) setSelectedItem(null) }}
        />
      )}
    </div>
  )
}
