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

/**
 * A line whose outcome nobody knows yet. "Cek status" looks it up in the Mitra
 * history; failing that, a person settles it by hand. Never retried or refunded
 * meanwhile.
 */
export function isPpobUncertain(status: string | null | undefined): boolean {
  return status === "uncertain"
}

/** The fields of a sold line that decide how its PPOB status reads. */
export interface PpobLineStatus {
  ppob_status: string | null
  ppob_advice?: string | null
  service_type?: string | null
}

/** The PPOB lines of a sale (goods have no `service_type`). */
export function ppobLines<T extends { service_type?: string | null }>(
  items: readonly T[] | undefined,
): T[] {
  return (items ?? []).filter((item) => item.service_type)
}

/**
 * A sale's PPOB lines are not all final yet. Before the detail first loads the
 * checkout result already says `pending`, so a line with no status counts too.
 */
export function hasPpobLineInFlight(items: readonly PpobLineStatus[]): boolean {
  return items.some((item) => isPpobInFlight(item.ppob_status ?? "pending"))
}

/**
 * Mitra answered `ADVICE`: the payment went to the biller and the result
 * (the PLN token, usually) comes later. Still `uncertain` underneath, but it
 * reads as waiting, not as a problem — the money is most likely spent.
 */
export function isPpobAwaitingBiller(line: PpobLineStatus): boolean {
  return isPpobUncertain(line.ppob_status) && line.ppob_advice != null
}

/** The badge for one line: like `ppobStatusConfig`, with ADVICE told apart. */
export function ppobLineStatusConfig(line: PpobLineStatus): PpobStatusConfig | null {
  if (isPpobAwaitingBiller(line)) {
    return {
      label: line.service_type === "pln" ? "Menunggu Konfirmasi PLN" : "Menunggu Konfirmasi",
      variant: "warning",
      inFlight: false,
    }
  }
  return ppobStatusConfig(line.ppob_status)
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

/**
 * The history row's PPOB badge, for the line that most needs a person (the
 * server picks it). A delivered top-up gets none — badges are for exceptions,
 * DESIGN.md §5.4 — and the generic labels say "PPOB" so "Gagal" next to
 * "Selesai" is not read as the sale failing.
 */
export function ppobRowBadge(
  row: PpobLineStatus & { has_ppob: boolean },
): { label: string; variant: StatusVariant } | null {
  if (!row.has_ppob || row.ppob_status === "success") return null
  const config = ppobLineStatusConfig(row)
  if (!config) return null
  const label = isPpobAwaitingBiller(row) ? config.label : `PPOB ${config.label.toLowerCase()}`
  return { label, variant: config.variant }
}

/** How often a sale is polled while a PPOB call is in flight. */
export const PPOB_IN_FLIGHT_POLL_MS = 1500

/**
 * The detail poll interval for a sale: fast while a PPOB line is pending or
 * processing, `false` otherwise. An uncertain line is not polled; the
 * reconciler first looks at it after 10 minutes.
 */
export function ppobSalePollInterval(items: readonly PpobLineStatus[]): number | false {
  return hasPpobLineInFlight(items) ? PPOB_IN_FLIGHT_POLL_MS : false
}
