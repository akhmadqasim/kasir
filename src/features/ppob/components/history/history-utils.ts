import {
  Smartphone,
  Zap,
  Droplets,
  ShieldCheck,
  Building2,
  Wallet,
  ArrowLeftRight,
  Wifi,
  Ticket,
  Package,
  type LucideIcon,
} from "lucide-react"
import { toLocalDateString } from "@/lib/format"
import { PPOB_SERVICE_COLORS, type PpobServiceKey } from "../../constants"
import { DEFAULT_PPOB_MARKUP, resolvePpobSellPrice } from "../../pricing"
import type { HistoryPaymentItem } from "../../types"
import type { PpobMarkup, PpobMarkupConfig } from "../../types/auth"

export interface ServiceInfo {
  /** The canonical service, or `null` for a row nothing here recognises. */
  key: PpobServiceKey | null
  icon: LucideIcon
  bg: string
  text: string
  label: string
}

function fromKey(key: PpobServiceKey, icon: LucideIcon, label: string): ServiceInfo {
  const c = PPOB_SERVICE_COLORS[key]
  return { key, icon, bg: c.bgMuted, text: c.text, label }
}

const SERVICE_MAP: Record<string, ServiceInfo> = {
  pulsa: fromKey("pulsa", Smartphone, "PULSA"),
  data: fromKey("data", Wifi, "PAKET DATA"),
  pln: fromKey("pln", Zap, "PLN"),
  pdam: fromKey("pdam", Droplets, "PDAM"),
  bpjs: fromKey("bpjs", ShieldCheck, "BPJS"),
  pp: fromKey("pp", Building2, "PAYMENT POINT"),
  payment_point: fromKey("pp", Building2, "PAYMENT POINT"),
  emoney: fromKey("emoney", Wallet, "E-MONEY"),
  "e-money": fromKey("emoney", Wallet, "E-MONEY"),
  transfer: fromKey("transfer", ArrowLeftRight, "TRANSFER"),
  voucher: fromKey("voucher", Ticket, "VOUCHER"),
}

const FALLBACK_SERVICE: ServiceInfo = {
  key: null,
  icon: Package,
  bg: "bg-default",
  text: "text-muted",
  label: "LAINNYA",
}

export function detectServiceType(item: HistoryPaymentItem): ServiceInfo {
  const desc = (item.description ?? "").toLowerCase()
  const productName = (item.productName ?? "").toLowerCase()
  const serviceType = (item.serviceType ?? "").toLowerCase()
  const combined = `${desc} ${productName} ${serviceType}`

  // PLN detection (highest priority — unique keywords)
  if (
    combined.includes("pln") ||
    combined.includes("token listrik") ||
    combined.includes("listrik")
  )
    return SERVICE_MAP.pln!

  // PDAM, BPJS, transfer, emoney — check before pulsa/data ambiguity
  if (combined.includes("pdam")) return SERVICE_MAP.pdam!
  if (combined.includes("bpjs")) return SERVICE_MAP.bpjs!
  if (combined.includes("transfer")) return SERVICE_MAP.transfer!
  if (combined.includes("e-money") || combined.includes("emoney")) return SERVICE_MAP["e-money"]!
  if (combined.includes("voucher")) return SERVICE_MAP.voucher!
  if (combined.includes("payment point") || combined.includes("payment_point"))
    return SERVICE_MAP.pp!

  // Pulsa vs Data: check description for data-specific keywords
  const isDataPacket = /\b(data|paket data|internet|\d+\s*gb|\d+\s*mb)\b/.test(desc)
  if (serviceType === "data" || serviceType === "pulsa") {
    return isDataPacket ? SERVICE_MAP.data! : SERVICE_MAP.pulsa!
  }

  // Fallback: try matching any key in combined text
  for (const [key, info] of Object.entries(SERVICE_MAP)) {
    if (combined.includes(key.replace("_", " ")) || combined.includes(key)) return info
  }
  return FALLBACK_SERVICE
}

export type NormalizedStatus = "sukses" | "gagal" | "proses" | "unknown"

export function normalizeStatus(status: string | null): NormalizedStatus {
  const s = (status ?? "").toLowerCase()
  if (s === "sukses" || s === "success" || s === "berhasil" || s === "done" || s === "completed")
    return "sukses"
  if (s === "gagal" || s === "failed" || s === "error") return "gagal"
  if (s === "pending" || s === "proses" || s === "processing" || s === "waiting") return "proses"
  return "unknown"
}

/**
 * Parse a timestamp as it arrives from Mitra.
 *
 * `ppob_get_mutasi` forwards the vendor's own strings untouched, and the vendor
 * is not consistent: payment history reports `created_at` as `YYYY-MM-DD HH:MM:SS`
 * while `formatted_date` on other endpoints is `DD-MM-YYYY HH:MM:SS`. `new Date()`
 * reads the second one as an invalid date, so anything that has to *compare*
 * timestamps — not just print them — needs this.
 *
 * Both are read as local time: the vendor reports WIB and the shop runs in it.
 */
export function parseMutasiDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null

  const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    trimmed,
  )
  if (dayFirst) {
    const [, day, month, year, hour, minute, second] = dayFirst
    return buildLocalDate(year, month, day, hour, minute, second)
  }

  const yearFirst = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    trimmed,
  )
  if (yearFirst) {
    const [, year, month, day, hour, minute, second] = yearFirst
    return buildLocalDate(year, month, day, hour, minute, second)
  }

  const fallback = new Date(trimmed)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function buildLocalDate(
  year: string,
  month: string,
  day: string,
  hour = "0",
  minute = "0",
  second = "0",
): Date | null {
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  )
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Whether a vendor timestamp falls inside a `YYYY-MM-DD` range, inclusive.
 * Returns `false` when the timestamp cannot be read at all — callers decide what
 * an undated row means rather than having it quietly counted.
 */
export function isWithinLocalDateRange(
  value: string | null | undefined,
  startDate: string,
  endDate: string,
): boolean {
  const date = parseMutasiDate(value)
  if (!date) return false

  const day = toLocalDateString(date)
  return day >= startDate && day <= endDate
}

export function formatDateTime(dateStr: string | null): string {
  const date = parseMutasiDate(dateStr)
  if (!date) return dateStr || "-"

  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function buildDescription(item: HistoryPaymentItem): string {
  // API returns productName as "-" for most history items
  const productName = item.productName && item.productName !== "-" ? item.productName : null
  const description = item.description && item.description !== "-" ? item.description : null

  if (productName) return productName
  if (description) return description

  // Fallback: build from available fields
  const parts: string[] = []
  if (item.provider) parts.push(item.provider)
  if (item.merchant) parts.push(item.merchant)
  if (item.denom) parts.push(item.denom)
  if (item.plu) parts.push(`#${item.plu}`)

  return parts.join(" - ") || "-"
}

export function getNominal(item: HistoryPaymentItem): number | null {
  return item.total ?? item.sellPrice ?? item.amount ?? null
}

/** The last seven local days as `Date` objects, for the calendar range picker. */
export function getDefaultDateRangeDates(): { from: Date; to: Date } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 7)
  return { from, to }
}

export function getDefaultDateRange() {
  const { from, to } = getDefaultDateRangeDates()
  // Local calendar days: `toISOString()` would report yesterday before 07:00 WIB.
  return {
    start: toLocalDateString(from),
    end: toLocalDateString(to),
  }
}

export const PRODUCT_FILTER_OPTIONS = [
  { key: "all", label: "Semua Produk" },
  { key: "pulsa", label: "Pulsa" },
  { key: "pln", label: "PLN" },
  { key: "pdam", label: "PDAM" },
  { key: "bpjs", label: "BPJS" },
  { key: "pp", label: "Payment Point" },
  { key: "emoney", label: "E-Money" },
  { key: "transfer", label: "Transfer" },
] as const

export const STATUS_FILTER_OPTIONS = [
  { key: "all", label: "Semua Status" },
  { key: "sukses", label: "Sukses" },
  { key: "gagal", label: "Gagal" },
  { key: "proses", label: "Proses" },
] as const

export function matchesProductFilter(item: HistoryPaymentItem, filter: string): boolean {
  if (filter === "all") return true

  // Use the same smart detection
  const detected = detectServiceType(item)

  const filterToLabel: Record<string, string> = {
    pulsa: "PULSA",
    data: "PAKET DATA",
    pln: "PLN",
    pdam: "PDAM",
    bpjs: "BPJS",
    pp: "PAYMENT POINT",
    emoney: "E-MONEY",
    transfer: "TRANSFER",
    voucher: "VOUCHER",
  }

  return detected.label === (filterToLabel[filter] ?? "")
}

/**
 * What the outlet paid the provider for this row, admin fee included — the
 * struk's `Total`, and the "Harga Modal" the sell price is measured against.
 *
 * Mirrors the server's reading of a history row: `amount` already carries the
 * admin fee (`basePrice` 20.000 + `adminFee` 3.500 = `amount` 23.500), `total`
 * is what other shapes call the same figure, and failing both the two parts
 * are added up.
 */
export function getProviderTotal(item: HistoryPaymentItem): number | null {
  if (item.amount != null) return item.amount
  if (item.total != null) return item.total
  if (item.basePrice != null) return item.basePrice + (item.adminFee ?? 0)
  return null
}

/** The services PPOB settings carry a markup block for. */
type MarkupServiceKey = {
  [K in keyof PpobMarkup]: PpobMarkup[K] extends PpobMarkupConfig ? K : never
}[keyof PpobMarkup]

const MARKUP_SERVICES: readonly MarkupServiceKey[] = [
  "pulsa",
  "data",
  "pln",
  "pdam",
  "bpjs",
  "emoney",
]

function hasMarkupBlock(key: PpobServiceKey): key is MarkupServiceKey {
  return (MARKUP_SERVICES as readonly string[]).includes(key)
}

/** The markup block in PPOB settings that applies to a service, if it has one. */
function markupFor(
  key: PpobServiceKey | null,
  markup: PpobMarkup | null | undefined,
): PpobMarkupConfig {
  return key && markup && hasMarkupBlock(key) ? markup[key] : DEFAULT_PPOB_MARKUP
}

/**
 * The default "Harga Jual" for printing a history row: the provider's total
 * plus the shop's markup for that service, or a custom price for the nominal
 * — the same rule that prices the line at the counter. Services with no
 * markup block (payment point, transfer) start at cost, and so does every
 * row until the settings have loaded.
 */
export function getDefaultSellPrice(
  item: HistoryPaymentItem,
  providerTotal: number,
  markup: PpobMarkup | null | undefined,
): number {
  const { key } = detectServiceType(item)
  return resolvePpobSellPrice({
    name: buildDescription(item),
    serviceType: key ?? "",
    vendorCost: providerTotal,
    markup: markupFor(key, markup),
    customPrices: markup?.custom_prices ?? {},
  })
}
