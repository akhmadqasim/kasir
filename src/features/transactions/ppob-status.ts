import type { StatusVariant } from "@/components/status-badge"

/**
 * Fulfilment states of a PPOB line, mirroring `PPOB_STATUS_*` in
 * `src-tauri/src/commands/transactions.rs`.
 *
 * `pending` is written at checkout and owned by the background task that follows
 * it; `processing` is owned by a retry that has already claimed the line. Both
 * mean a provider call is in flight, so `claim_ppob_retry` rejects them with a
 * validation error — a retry button that offers them only produces that error.
 */
export type PpobItemStatus = "pending" | "processing" | "success" | "failed"

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

export const PPOB_STATUS_CONFIG: Record<string, PpobStatusConfig> = {
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
}

export function ppobStatusConfig(
  status: string | null | undefined
): PpobStatusConfig | null {
  if (!status) return null
  return PPOB_STATUS_CONFIG[status] ?? null
}

/** Only a failed line may be retried; the backend rejects everything else. */
export function isPpobRetryable(status: string | null | undefined): boolean {
  return status === "failed"
}

/** Whether to show the spinner: a provider call has not reported back yet. */
export function isPpobInFlight(status: string | null | undefined): boolean {
  return ppobStatusConfig(status)?.inFlight ?? false
}
