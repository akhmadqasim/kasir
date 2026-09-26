import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import type { InquiryResult, PpSubMenuItem } from "../../types"
import { markupItem } from "../quick-access/markup-item"

/**
 * "Periode" is not a field on `InquiryResult` — only a handful of billers
 * (postpaid subscriptions) carry one, buried in whatever shape the upstream
 * answered with. Read defensively from the raw response and say nothing when
 * it is not there, the same way the admin fee row disappears for a biller
 * that does not charge one.
 */
function extractPeriodLabel(rawData: InquiryResult["rawData"]): string | null {
  const nested = rawData.data
  const sources = [
    rawData,
    typeof nested === "object" && nested !== null ? (nested as Record<string, unknown>) : null,
  ]

  for (const source of sources) {
    if (!source) continue
    for (const key of ["period", "periode"]) {
      const value = source[key]
      if (typeof value === "string" && value.trim()) return value
      if (typeof value === "number") return String(value)
    }
  }

  return null
}

interface PpConfirmInput {
  groupName: string | undefined
  merchant: PpSubMenuItem
  paymentCode: string
  inquiry: InquiryResult
  /** Yang dibayar toko ke vendor: tagihan + biaya admin. */
  vendorCost: number
  sellPrice: number
}

/** The confirm card's rows for a Payment Point bill that has been looked up. */
export function buildPpConfirmItems({
  groupName,
  merchant,
  paymentCode,
  inquiry,
  vendorCost,
  sellPrice,
}: PpConfirmInput): SummaryItem[] {
  const period = extractPeriodLabel(inquiry.rawData)
  return [
    { label: id.ppob.selectGroup, value: groupName ?? "-" },
    { label: id.ppob.selectMerchant, value: merchant.merchant },
    { label: merchant.label || id.ppob.paymentCode, value: paymentCode, tone: "mono" },
    { label: "Nama", value: inquiry.customerName ?? "-" },
    ...(period ? [{ label: id.ppob.period, value: period }] : []),
    { label: "Tagihan", value: formatRupiah(inquiry.amount) },
    ...(inquiry.adminFee > 0 ? [{ label: "Admin", value: formatRupiah(inquiry.adminFee) }] : []),
    ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
    { label: "Total Bayar", value: formatRupiah(sellPrice), tone: "strong" },
  ]
}
