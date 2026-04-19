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
import { PPOB_SERVICE_COLORS, type PpobServiceKey } from "../../constants"
import type { HistoryPaymentItem } from "../../types"

export interface ServiceInfo {
  icon: LucideIcon
  bg: string
  text: string
  label: string
}

function fromKey(key: PpobServiceKey, icon: LucideIcon, label: string): ServiceInfo {
  const c = PPOB_SERVICE_COLORS[key]
  return { icon, bg: c.bgMuted, text: c.text, label }
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
  icon: Package,
  bg: "bg-muted",
  text: "text-muted-foreground",
  label: "LAINNYA",
}

export function detectServiceType(item: HistoryPaymentItem): ServiceInfo {
  const desc = (item.description ?? "").toLowerCase()
  const productName = (item.productName ?? "").toLowerCase()
  const serviceType = (item.serviceType ?? "").toLowerCase()
  const combined = `${desc} ${productName} ${serviceType}`

  // PLN detection (highest priority — unique keywords)
  if (combined.includes("pln") || combined.includes("token listrik") || combined.includes("listrik"))
    return SERVICE_MAP.pln!

  // PDAM, BPJS, transfer, emoney — check before pulsa/data ambiguity
  if (combined.includes("pdam")) return SERVICE_MAP.pdam!
  if (combined.includes("bpjs")) return SERVICE_MAP.bpjs!
  if (combined.includes("transfer")) return SERVICE_MAP.transfer!
  if (combined.includes("e-money") || combined.includes("emoney")) return SERVICE_MAP["e-money"]!
  if (combined.includes("voucher")) return SERVICE_MAP.voucher!
  if (combined.includes("payment point") || combined.includes("payment_point")) return SERVICE_MAP.pp!

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
  if (s === "sukses" || s === "success" || s === "berhasil" || s === "done" || s === "completed") return "sukses"
  if (s === "gagal" || s === "failed" || s === "error") return "gagal"
  if (s === "pending" || s === "proses" || s === "processing" || s === "waiting") return "proses"
  return "unknown"
}

export function formatRupiah(n: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(n)
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-"
  try {
    return new Date(dateStr).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateStr
  }
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

export function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export const PRODUCT_FILTER_OPTIONS = [
  { value: "all", label: "Semua Produk" },
  { value: "pulsa", label: "Pulsa" },
  { value: "pln", label: "PLN" },
  { value: "pdam", label: "PDAM" },
  { value: "bpjs", label: "BPJS" },
  { value: "pp", label: "Payment Point" },
  { value: "emoney", label: "E-Money" },
  { value: "transfer", label: "Transfer" },
] as const

export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "sukses", label: "Sukses" },
  { value: "gagal", label: "Gagal" },
  { value: "proses", label: "Proses" },
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
