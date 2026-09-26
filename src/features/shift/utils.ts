import type { StatusVariant } from "@/components/status-badge"
import type { SummaryItem } from "@/components/summary-list"
import { formatNumber, formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import type { CashFlow, PaymentBreakdown, ShiftSummary } from "./types"

const groupFormatter = new Intl.NumberFormat("id-ID")

/**
 * Cash is typed, not stepped: the kasir reads notes out of the drawer and types
 * the total. `NumberField` would commit on blur and bind the arrow keys to
 * ±1 rupiah, so the cash fields stay text inputs that keep only the digits and
 * regroup them on every keystroke — exactly what they did before the migration.
 */
export function toDigits(value: string): string {
  const digits = value.replace(/\D/g, "")
  return digits === "" ? "" : String(Number(digits))
}

/** The grouped form shown in the input, e.g. `"50000"` -> `"50.000"`. */
export function groupDigits(digits: string): string {
  return digits === "" ? "" : groupFormatter.format(Number(digits))
}

/** Rupiah with an explicit `+` on the positive side, for balances that can go either way. */
export function signedRupiah(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${formatRupiah(amount)}`
}

/** A cash flow as it moves the drawer: money in is positive, money out negative. */
export function signedCashFlowAmount(cashFlow: CashFlow): number {
  return cashFlow.flowType === "in" ? cashFlow.amount : -cashFlow.amount
}

/**
 * One row per payment method, the transaction count in the label as text —
 * the same on screen and on the printed report (DESIGN.md §5.4).
 */
export function paymentBreakdownItems(breakdown: PaymentBreakdown[]): SummaryItem[] {
  return breakdown.map((pb) => ({
    label: `${paymentMethodLabel(pb.method)} (${formatNumber(pb.count)}×)`,
    value: formatRupiah(pb.total),
  }))
}

/** The "Total" line under a list of cash flows: net in minus out, coloured by its sign. */
export function netCashFlowItem({ cashIn, cashOut }: ShiftSummary): SummaryItem {
  const net = cashIn - cashOut
  return { label: "Total", value: signedRupiah(net), tone: net >= 0 ? "success" : "danger" }
}

/**
 * The summary as it stands once `cashFlow` is deleted: the row gone and the
 * totals it fed backed out, the same way the server derives them
 * (`expectedCash = opening + cash sales + cashIn - cashOut - cashRefunds`).
 * Lets the page drop a deleted row even when the reload after it fails.
 */
export function withoutCashFlow(summary: ShiftSummary, cashFlow: CashFlow): ShiftSummary {
  if (!summary.cashFlows.some((cf) => cf.id === cashFlow.id)) return summary
  const isIn = cashFlow.flowType === "in"
  return {
    ...summary,
    cashFlows: summary.cashFlows.filter((cf) => cf.id !== cashFlow.id),
    cashIn: isIn ? summary.cashIn - cashFlow.amount : summary.cashIn,
    cashOut: isIn ? summary.cashOut : summary.cashOut - cashFlow.amount,
    expectedCash: summary.expectedCash - signedCashFlowAmount(cashFlow),
  }
}

/**
 * A drawer short by more than a rupiah is the only case worth colouring red; a
 * rounding-level gap reads as "matched", and a surplus is worth noticing but is
 * not an error.
 */
export function cashDifferenceStatus(difference: number): StatusVariant {
  if (Math.abs(difference) < 1) return "neutral"
  return difference < 0 ? "error" : "info"
}

/**
 * The difference in words, so the badge does not lean on its colour alone
 * (DESIGN.md §7): a cashier glancing at "Kurang" knows the drawer is short
 * before reading the sign on the number.
 */
export function cashDifferenceText(difference: number): string {
  if (Math.abs(difference) < 1) return "Sesuai"
  return `${difference < 0 ? "Kurang" : "Lebih"} ${signedRupiah(difference)}`
}
