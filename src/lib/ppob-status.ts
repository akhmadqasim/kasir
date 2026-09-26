import type { StatusVariant } from "@/components/status-badge"

/**
 * Fulfilment states of a PPOB line, mirroring `PPOB_STATUS_*` in
 * `src-tauri/src/services/transactions/mod.rs`.
 *
 * `pending` is written at checkout and owned by the background task that follows
 * it; `processing` is owned by a retry that has already claimed the line. Both
 * mean a provider call is in flight, so `claim_ppob_retry` rejects them with a
 * validation error — a retry button that offers them only produces that error.
 *
 * `uncertain` means the provider call went out but no usable answer came back
 * (or the app closed mid-call): the money may be spent, so it is neither retried
 * nor refunded until someone checks the Mitra history and settles it by hand.
 */
export type PpobItemStatus = "pending" | "processing" | "success" | "failed" | "uncertain"

export interface PpobStatusConfig {
  label: string
  /**
   * What the state *means*, in the vocabulary of `components/status-badge.tsx`.
   * The colour itself is that component's business: a `bg-amber-50` written here
   * carries no dark-mode story of its own and drifts away from every other badge.
   */
  variant: StatusVariant
  /** A provider call is still running, so the row is not final yet. */
  inFlight: boolean
}

export const PPOB_STATUS_CONFIG: Record<PpobItemStatus, PpobStatusConfig> = {
  pending: {
    label: "Menunggu",
    variant: "warning",
    inFlight: true,
  },
  processing: {
    label: "Sedang Diproses",
    variant: "info",
    inFlight: true,
  },
  success: {
    label: "Berhasil",
    variant: "success",
    inFlight: false,
  },
  failed: {
    label: "Gagal",
    variant: "error",
    inFlight: false,
  },
  uncertain: {
    label: "Perlu Dicek",
    variant: "warning",
    inFlight: false,
  },
}

/**
 * Narrow a stored status to a known one. An own-key check, not `in` or a plain
 * lookup: those also match `Object.prototype` members such as `"toString"`.
 */
function isPpobItemStatus(status: string): status is PpobItemStatus {
  return Object.hasOwn(PPOB_STATUS_CONFIG, status)
}

export function ppobStatusConfig(status: string | null | undefined): PpobStatusConfig | null {
  if (!status || !isPpobItemStatus(status)) return null
  return PPOB_STATUS_CONFIG[status]
}

/** Only a failed line may be retried; the backend rejects everything else. */
export function isPpobRetryable(status: string | null | undefined): boolean {
  return status === "failed"
}

/** A line whose outcome nobody knows yet; only a person can settle it. */
export function isPpobUncertain(status: string | null | undefined): boolean {
  return status === "uncertain"
}

/**
 * Only a fulfilled line has a struk. Before that there is no token, no serial
 * number and nothing from the provider to print, and the backend says so.
 */
export function isPpobPrintable(status: string | null | undefined): boolean {
  return status === "success"
}

/** Whether to show the spinner: a provider call has not reported back yet. */
export function isPpobInFlight(status: string | null | undefined): boolean {
  return ppobStatusConfig(status)?.inFlight ?? false
}
