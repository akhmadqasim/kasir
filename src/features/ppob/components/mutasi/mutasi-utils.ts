import { formatRupiah } from "@/lib/format"
import { isWithinLocalDateRange, normalizeStatus, parseMutasiDate } from "../history/history-utils"
import type { MutasiItem } from "../../types"

/** The amount with its direction as a sign, so it never rests on colour alone. */
export function formatSignedAmount(item: MutasiItem): string {
  const sign = item.mutationType === "in" ? "+" : "-"
  return `${sign}${item.amount != null ? formatRupiah(item.amount) : "-"}`
}

/**
 * Topups are not date-filtered by the backend and cannot be.
 *
 * `ppob_get_mutasi` sends the range to `history-payment`, but the vendor's
 * `topup/history` takes only a `device_id` — the OpenAPI contract has no date
 * parameters at all — so it always answers with the account's whole topup
 * history. Every `in` row therefore has to be narrowed here, or "Total Masuk"
 * reports every topup ever made regardless of the range on screen.
 *
 * `undatedIn` counts the topups whose date cannot be read: they cannot be
 * placed in or out of the range, so they are kept visible and the screen says
 * so rather than dropping money off it without a word.
 */
export function narrowTopupsToRange(
  items: MutasiItem[],
  startDate: string,
  endDate: string,
): { items: MutasiItem[]; undatedIn: number } {
  const kept: MutasiItem[] = []
  let undatedIn = 0
  for (const item of items) {
    if (item.mutationType !== "in") {
      kept.push(item)
    } else if (isWithinLocalDateRange(item.createdAt, startDate, endDate)) {
      kept.push(item)
    } else if (!parseMutasiDate(item.createdAt)) {
      kept.push(item)
      undatedIn++
    }
  }
  return { items: kept, undatedIn }
}

interface MutasiSummary {
  totalIn: number
  totalOut: number
  countIn: number
  countOut: number
}

/** Totals per direction, counting only movements the vendor reports as successful. */
export function summarizeMutasi(items: MutasiItem[]): MutasiSummary {
  const summary: MutasiSummary = { totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 }
  for (const item of items) {
    if (normalizeStatus(item.status) !== "sukses") continue
    const amount = item.amount ?? 0
    if (item.mutationType === "in") {
      summary.totalIn += amount
      summary.countIn++
    } else if (item.mutationType === "out") {
      summary.totalOut += amount
      summary.countOut++
    }
  }
  return summary
}
