import { Button } from "@heroui/react"

import { QUICK_AMOUNT_OPTIONS } from "./use-payment-form"
import { formatRupiah } from "../../utils"

interface CashFieldsProps {
  onQuickAmount: (amount: number) => void
  onRemainingAmount: () => void
}

function formatQuickAmountLabel(amount: number): string {
  if (amount >= 1000 && amount % 1000 === 0) {
    return `${amount / 1000}k`
  }
  return formatRupiah(amount).replace("Rp", "").trim()
}

/**
 * Pembulatan cepat (5.000/10.000/…/100.000) dan "Uang Pas", untuk metode
 * yang sedang aktif — berguna juga di PC, bukan cuma layar sentuh, jadi tetap
 * ada meski keypad-nya dihapus.
 */
export function CashFields({ onQuickAmount, onRemainingAmount }: CashFieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-2">
        {QUICK_AMOUNT_OPTIONS.map((amount) => (
          <Button
            key={amount}
            className="tabular-nums"
            size="sm"
            variant="secondary"
            onPress={() => onQuickAmount(amount)}
          >
            {formatQuickAmountLabel(amount)}
          </Button>
        ))}
      </div>
      <Button fullWidth size="sm" variant="secondary" onPress={onRemainingAmount}>
        Uang Pas
      </Button>
    </div>
  )
}
