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
  color: string
}

export const PPOB_SERVICES: PpobServiceDef[] = [
  { key: "pulsa", icon: Smartphone, label: id.ppob.pulsa, path: "pulsa", color: "text-blue-500" },
  { key: "data", icon: Wifi, label: id.ppob.dataPacket, path: "data", color: "text-purple-500" },
  { key: "pln", icon: Zap, label: id.ppob.pln, path: "pln", color: "text-yellow-500" },
  { key: "pdam", icon: Droplets, label: id.ppob.pdam, path: "pdam", color: "text-cyan-500" },
  { key: "bpjs", icon: HeartPulse, label: id.ppob.bpjs, path: "bpjs", color: "text-red-500" },
  { key: "pp", icon: CreditCard, label: id.ppob.pp, path: "pp", color: "text-green-500" },
  { key: "transfer", icon: ArrowRightLeft, label: id.ppob.transfer, path: "transfer", color: "text-orange-500" },
  { key: "emoney", icon: Wallet, label: id.ppob.emoney, path: "emoney", color: "text-pink-500" },
  { key: "voucher", icon: Ticket, label: id.ppob.voucher, path: "voucher", color: "text-indigo-500" },
]

const QUICK_ACCESS_KEYS: Set<PpobServiceKey> = new Set(["pulsa", "data", "pln", "pdam", "bpjs", "emoney"])

export const QUICK_ACCESS_SERVICES = PPOB_SERVICES.filter(
  (svc): svc is PpobServiceDef & { key: QuickAccessServiceKey } => QUICK_ACCESS_KEYS.has(svc.key),
)

export function getServiceByKey(key: string): PpobServiceDef | undefined {
  return PPOB_SERVICES.find((svc) => svc.key === key)
}
