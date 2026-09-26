import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"

/** Baris "Markup" di ringkasan konfirmasi — selisih harga jual dan modal vendor. */
export function markupItem(sellPrice: number, vendorCost: number): SummaryItem {
  return {
    label: id.ppob.quickAccess.markup,
    value: `+${formatRupiah(sellPrice - vendorCost)}`,
    tone: "success",
  }
}
