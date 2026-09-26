import type { StatusVariant } from "@/components/status-badge"

/**
 * Write-off vocabulary shared by the stock screen, its form and the loss report,
 * which used to keep three copies of the same labels.
 */
export const WRITEOFF_REASON_OPTIONS = [
  { key: "damaged", label: "Rusak" },
  { key: "expired", label: "Kadaluarsa" },
  { key: "lost", label: "Hilang" },
  { key: "other", label: "Lainnya" },
] as const

export const WRITEOFF_STATUS_OPTIONS = [
  { key: "pending", label: "Menunggu" },
  { key: "approved", label: "Disetujui" },
  { key: "rejected", label: "Ditolak" },
] as const

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  WRITEOFF_REASON_OPTIONS.map(({ key, label }) => [key, label]),
)

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  WRITEOFF_STATUS_OPTIONS.map(({ key, label }) => [key, label]),
)

const STATUS_VARIANTS: Record<string, StatusVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
}

export function writeoffReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

export function writeoffStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function writeoffStatusVariant(status: string): StatusVariant {
  return STATUS_VARIANTS[status] ?? "neutral"
}
