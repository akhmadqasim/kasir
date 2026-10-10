import { InfoPanel } from "@/components/info-panel"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"

interface ChangeTotalPanelProps {
  /** `null` reads as no change. */
  changeAmount: number | null
  totalAmount: number
}

/**
 * Change on top, large: it is what the cashier hands over now, read by the
 * customer across the counter. The total below is a small reminder. The
 * change row always shows, also as "Rp 0".
 */
export function ChangeTotalPanel({ changeAmount, totalAmount }: ChangeTotalPanelProps) {
  return (
    <InfoPanel className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted">{id.cashier.change}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums text-success">
          {formatRupiah(changeAmount ?? 0)}
        </p>
      </div>
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted">Total</p>
        <p className="text-base font-medium tabular-nums text-muted">{formatRupiah(totalAmount)}</p>
      </div>
    </InfoPanel>
  )
}
