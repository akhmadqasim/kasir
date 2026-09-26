import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"

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

// Fields that carry rupiah amounts
const MONEY_KEYS = new Set([
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
])

function formatRawValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "object") return null

  const str = String(value)
  if (str === "-" || str === "0" || str === "0.0" || str.trim() === "") return null

  if (MONEY_KEYS.has(key) && !isNaN(Number(value))) {
    return formatRupiah(Number(value))
  }

  return str
}

function labelFor(key: string): string {
  return DISPLAY_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The vendor's raw mutasi record as label/value rows: known fields first in a
 * fixed order, then whatever else it carried, with internal and empty fields
 * dropped and a label shown only once even when two keys share it.
 */
export function buildMutasiDetailRows(raw: Record<string, unknown>): SummaryItem[] {
  const seenKeys = new Set<string>()
  const seenLabels = new Set<string>()
  const rows: SummaryItem[] = []

  const addRow = (key: string, val: unknown) => {
    if (HIDDEN_KEYS.has(key) || seenKeys.has(key)) return
    seenKeys.add(key)
    const formatted = formatRawValue(key, val)
    if (!formatted) return
    const label = labelFor(key)
    // Deduplicate by label — keep only first occurrence of each label
    if (seenLabels.has(label)) return
    seenLabels.add(label)
    rows.push({ label, value: formatted })
  }

  for (const key of PRIORITY_KEYS) {
    if (raw[key] !== undefined) addRow(key, raw[key])
  }

  // Remaining keys not in priority list
  for (const [key, val] of Object.entries(raw)) {
    addRow(key, val)
  }

  return rows
}
