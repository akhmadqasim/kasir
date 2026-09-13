import { RupiahField } from "@/components/rupiah-field"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { id as t } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import type { HistoryPrintControl } from "./use-history-print"

/** The fee field and the Grand Total it produces, for the detail dialog's body. */
export function HistoryPrintFields({ control }: { control: HistoryPrintControl }) {
  const { fee, setFee, sellPrice, hasPrice } = control

  const grandTotal: SummaryItem = {
    label: t.ppob.grandTotal,
    // `hasPrice` already implies non-null; the extra check is for the type checker.
    value: hasPrice && sellPrice != null ? formatRupiah(sellPrice) : "-",
    tone: hasPrice && fee != null && fee < 0 ? "danger" : "default",
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Thousands grouped as they are typed; a negative fee is a discount. */}
      <RupiahField allowNegative label={t.ppob.serviceFee} value={fee} onChange={setFee} />

      <SummaryList items={[grandTotal]} layout="row" />
    </div>
  )
}
