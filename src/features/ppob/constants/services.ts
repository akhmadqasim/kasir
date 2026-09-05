import {
  Smartphone,
  Zap,
  Droplets,
  HeartPulse,
  CreditCard,
  ArrowRightLeft,
  Wallet,
  Ticket,
  Wifi,
} from "lucide-react"
import { id } from "@/i18n/id"

export type PpobServiceKey =
  | "pulsa"
  | "data"
  | "pln"
  | "pdam"
  | "bpjs"
  | "pp"
  | "transfer"
  | "emoney"
  | "voucher"

export type QuickAccessServiceKey = "pulsa" | "data" | "pln" | "pdam" | "bpjs" | "emoney"

export interface PpobServiceDef {
  key: PpobServiceKey
  icon: typeof Smartphone
  label: string
  path: string
}

/** Presentational color classes keyed by service — only import in UI components */
export const PPOB_SERVICE_COLORS: Record<PpobServiceKey, { text: string; bg: string; bgMuted: string }> = {
  pulsa:    { text: "text-blue-600",   bg: "bg-blue-500",   bgMuted: "bg-blue-100 dark:bg-blue-950" },
  data:     { text: "text-purple-600", bg: "bg-purple-500", bgMuted: "bg-purple-100 dark:bg-purple-950" },
  pln:      { text: "text-yellow-600", bg: "bg-yellow-500", bgMuted: "bg-yellow-100 dark:bg-yellow-950" },
  pdam:     { text: "text-cyan-600",   bg: "bg-cyan-500",   bgMuted: "bg-cyan-100 dark:bg-cyan-950" },
  bpjs:     { text: "text-red-600",    bg: "bg-red-500",    bgMuted: "bg-red-100 dark:bg-red-950" },
  pp:       { text: "text-green-600",  bg: "bg-green-500",  bgMuted: "bg-green-100 dark:bg-green-950" },
  transfer: { text: "text-orange-600", bg: "bg-orange-500", bgMuted: "bg-orange-100 dark:bg-orange-950" },
  emoney:   { text: "text-pink-600",   bg: "bg-pink-500",   bgMuted: "bg-pink-100 dark:bg-pink-950" },
  voucher:  { text: "text-indigo-600", bg: "bg-indigo-500", bgMuted: "bg-indigo-100 dark:bg-indigo-950" },
}

export const PPOB_SERVICES: PpobServiceDef[] = [
  { key: "pulsa", icon: Smartphone, label: id.ppob.pulsa, path: "pulsa" },
  { key: "data", icon: Wifi, label: id.ppob.dataPacket, path: "data" },
  { key: "pln", icon: Zap, label: id.ppob.pln, path: "pln" },
  { key: "pdam", icon: Droplets, label: id.ppob.pdam, path: "pdam" },
  { key: "bpjs", icon: HeartPulse, label: id.ppob.bpjs, path: "bpjs" },
  { key: "pp", icon: CreditCard, label: id.ppob.pp, path: "pp" },
  { key: "transfer", icon: ArrowRightLeft, label: id.ppob.transfer, path: "transfer" },
  { key: "emoney", icon: Wallet, label: id.ppob.emoney, path: "emoney" },
  { key: "voucher", icon: Ticket, label: id.ppob.voucher, path: "voucher" },
]

const QUICK_ACCESS_KEYS: Set<PpobServiceKey> = new Set(["pulsa", "data", "pln", "pdam", "bpjs", "emoney"])

export const QUICK_ACCESS_SERVICES = PPOB_SERVICES.filter(
  (svc): svc is PpobServiceDef & { key: QuickAccessServiceKey } => QUICK_ACCESS_KEYS.has(svc.key),
)
