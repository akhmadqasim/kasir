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
  className: string
  /** A provider call is still running, so the row is not final yet. */
  inFlight: boolean
}

export const PPOB_STATUS_CONFIG: Record<string, PpobStatusConfig> = {
  pending: {
    label: "Menunggu",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    inFlight: true,
  },
  processing: {
    label: "Sedang Diproses",
    className: "bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    inFlight: true,
  },
  success: {
    label: "Berhasil",
    className: "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300",
    inFlight: false,
  },
  failed: {
    label: "Gagal",
    className: "bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300",
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
