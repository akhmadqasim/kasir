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

/**
 * Kelas warna per layanan — hanya boleh diimpor komponen UI.
 *
 * Setiap layanan menunjuk satu token `--service-*` di `index.css`, bukan warna
 * Tailwind mentah. Konsekuensinya tidak ada lagi `dark:` di sini: tokennya
 * sudah dipilih pada pita lightness yang terbaca di kedua mode, dan latar
 * redupnya diturunkan dengan penanda opasitas Tailwind alih-alih warna kedua
 * yang harus dijaga tetap seiring.
 *
 * Kelasnya sengaja ditulis lengkap sebagai literal, bukan disusun dari
 * `key`-nya, karena Tailwind memindai berkas sumber apa adanya dan kelas yang
 * dirakit saat runtime tidak akan pernah ikut ter-generate.
 */
export const PPOB_SERVICE_COLORS: Record<
  PpobServiceKey,
  { text: string; bg: string; bgMuted: string }
> = {
  pulsa: {
    text: "text-[var(--service-pulsa)]",
    bg: "bg-[var(--service-pulsa)]",
    bgMuted: "bg-[var(--service-pulsa)]/15",
  },
  data: {
    text: "text-[var(--service-data)]",
    bg: "bg-[var(--service-data)]",
    bgMuted: "bg-[var(--service-data)]/15",
  },
  pln: {
    text: "text-[var(--service-pln)]",
    bg: "bg-[var(--service-pln)]",
    bgMuted: "bg-[var(--service-pln)]/15",
  },
  pdam: {
    text: "text-[var(--service-pdam)]",
    bg: "bg-[var(--service-pdam)]",
    bgMuted: "bg-[var(--service-pdam)]/15",
  },
  bpjs: {
    text: "text-[var(--service-bpjs)]",
    bg: "bg-[var(--service-bpjs)]",
    bgMuted: "bg-[var(--service-bpjs)]/15",
  },
  pp: {
    text: "text-[var(--service-pp)]",
    bg: "bg-[var(--service-pp)]",
    bgMuted: "bg-[var(--service-pp)]/15",
  },
  transfer: {
    text: "text-[var(--service-transfer)]",
    bg: "bg-[var(--service-transfer)]",
    bgMuted: "bg-[var(--service-transfer)]/15",
  },
  emoney: {
    text: "text-[var(--service-emoney)]",
    bg: "bg-[var(--service-emoney)]",
    bgMuted: "bg-[var(--service-emoney)]/15",
  },
  voucher: {
    text: "text-[var(--service-voucher)]",
    bg: "bg-[var(--service-voucher)]",
    bgMuted: "bg-[var(--service-voucher)]/15",
  },
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

export type QuickAccessServiceDef = PpobServiceDef & { key: QuickAccessServiceKey }

// `Record` dan bukan `Set`: TypeScript menuntut setiap anggota
// `QuickAccessServiceKey` ada di sini, jadi lookup di bawah tidak bisa bolong.
const QUICK_ACCESS_KEYS: Record<QuickAccessServiceKey, true> = {
  pulsa: true,
  data: true,
  pln: true,
  pdam: true,
  bpjs: true,
  emoney: true,
}

export const QUICK_ACCESS_SERVICES = PPOB_SERVICES.filter(
  (svc): svc is QuickAccessServiceDef => svc.key in QUICK_ACCESS_KEYS,
)

/** Layanan per kunci; setiap kunci pasti ada karena `QUICK_ACCESS_KEYS` lengkap. */
export const QUICK_ACCESS_SERVICE_BY_KEY = Object.fromEntries(
  QUICK_ACCESS_SERVICES.map((svc) => [svc.key, svc]),
) as Record<QuickAccessServiceKey, QuickAccessServiceDef>
