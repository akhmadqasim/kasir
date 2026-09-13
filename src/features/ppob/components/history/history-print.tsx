import { RupiahField } from "@/components/rupiah-field"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { id as t } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import type { HistoryPrintControl } from "./use-history-print"

/** The fee field and the Grand Total it produces, for the detail dialog's body. */
export function HistoryPrintFields({ control }: { control: HistoryPrintControl }) {
  const { fee, setFee, sellPrice } = control

  const grandTotal: SummaryItem = {
    label: t.ppob.grandTotal,
    value: sellPrice != null ? formatRupiah(sellPrice) : "-",
    tone: sellPrice != null && fee != null && fee < 0 ? "danger" : "default",
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Starts empty, which is no fee; a negative fee is a discount. */}
      <RupiahField
        allowNegative
        label={t.ppob.serviceFee}
        placeholder="0"
        value={fee}
        onChange={setFee}
      />

      <SummaryList items={[grandTotal]} layout="row" />
    </div>
  )
}
