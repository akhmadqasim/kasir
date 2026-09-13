import { Label, NumberField } from "@heroui/react"

import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { id as t } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import type { HistoryPrintControl } from "./use-history-print"

/** The fee field and the Grand Total it produces, for the detail dialog's body. */
export function HistoryPrintFields({ control }: { control: HistoryPrintControl }) {
  const { providerTotal, fee, setFee, sellPrice, hasPrice } = control

  const grandTotal: SummaryItem = {
    label: t.ppob.grandTotal,
    value: hasPrice ? formatRupiah(sellPrice) : "-",
    tone: hasPrice && fee != null && fee < 0 ? "danger" : "default",
  }

  return (
    <div className="flex flex-col gap-3">
      <NumberField
        fullWidth
        // Whole rupiah with the Indonesian thousands dot; the locale comes
        // from the app's I18nProvider.
        formatOptions={{ maximumFractionDigits: 0 }}
        minValue={providerTotal != null ? -providerTotal : undefined}
        value={fee ?? Number.NaN}
        variant="secondary"
        onChange={(value) => setFee(value === undefined || Number.isNaN(value) ? null : value)}
      >
        <Label>{t.ppob.serviceFee}</Label>
        {/* No +/- buttons: a rupiah amount is typed, and any step that made
            the buttons useful would snap a typed 1.729 to it. */}
        <NumberField.Group>
          <NumberField.Input className="text-right tabular-nums" />
        </NumberField.Group>
      </NumberField>

      <SummaryList items={[grandTotal]} layout="row" />
    </div>
  )
}
