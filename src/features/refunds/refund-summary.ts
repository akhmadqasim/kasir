import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { differenceDirectionLabel, differenceTone } from "./labels"

interface RefundTotals {
  isExchange: boolean
  totalRefund: number
  totalExchange: number
  /** `totalRefund - totalExchange`: positive = the shop pays back, negative = the customer pays. */
  difference: number
}

/**
 * The money lines of a refund, shared by the refund form and the refund detail
 * so both read the same: a plain refund shows only its total; an exchange adds
 * the replacement total and the difference.
 */
export function refundTotalsSummary({
  isExchange,
  totalRefund,
  totalExchange,
  difference,
}: RefundTotals): SummaryItem[] {
  const refundLine: SummaryItem = {
    label: id.refund.totalRefund,
    value: formatRupiah(totalRefund),
    tone: isExchange ? "default" : "strong",
  }
  if (!isExchange) return [refundLine]

  const direction = differenceDirectionLabel(difference)
  return [
    refundLine,
    { label: id.refund.totalExchange, value: formatRupiah(totalExchange) },
    {
      // The direction is spelled out in the label, so the colour is never the
      // only thing telling who pays whom (DESIGN.md §7).
      label: direction ? `${id.refund.difference} (${direction})` : id.refund.difference,
      value: formatRupiah(Math.abs(difference)),
      tone: differenceTone(difference) ?? "strong",
    },
  ]
}
