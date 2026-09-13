import { Button, Kbd } from "@heroui/react"

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
    // Membungkus, bukan kisi lima kolom: di kolom kanan dialog, lima tombol
    // sebaris melebar melewati kolomnya dan memunculkan gulir mendatar.
    <div className="flex flex-wrap gap-2">
      <Button className="grow" size="sm" variant="secondary" onPress={onRemainingAmount}>
        Uang Pas
        <Kbd variant="light">
          <Kbd.Content>\</Kbd.Content>
        </Kbd>
      </Button>
      {QUICK_AMOUNT_OPTIONS.map((amount) => (
        <Button
          key={amount}
          className="tabular-nums"
          size="sm"
          variant="tertiary"
          onPress={() => onQuickAmount(amount)}
        >
          {formatQuickAmountLabel(amount)}
        </Button>
      ))}
    </div>
  )
}
