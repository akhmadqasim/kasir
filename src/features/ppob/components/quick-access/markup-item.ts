import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"

/** Baris "Markup" di ringkasan konfirmasi — selisih harga jual dan modal vendor. */
export function markupItem(sellPrice: number, vendorCost: number): SummaryItem {
  return {
    label: "Markup",
    value: `+${formatRupiah(sellPrice - vendorCost)}`,
    tone: "success",
  }
}
