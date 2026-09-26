import { Button, Kbd } from "@heroui/react"

import { QUICK_AMOUNT_OPTIONS } from "./payment-methods"
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
      <Button className="grow" size="sm" variant="tertiary" onPress={onRemainingAmount}>
        Uang Pas
        {/* Pintasannya `\` di kolom nominal (dan backtick di mana saja);
            tanpa petunjuk ini tidak ada yang tahu. Visual saja. */}
        <Kbd aria-hidden="true">
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
          {/* "5k" is how the till reads it; a screen reader also gets the
              amount. Appended rather than an `aria-label`, so the name still
              starts with the visible text (WCAG 2.5.3, voice control). */}
          <span className="sr-only">, {formatRupiah(amount)}</span>
        </Button>
      ))}
    </div>
  )
}
