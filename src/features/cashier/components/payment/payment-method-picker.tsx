import { useId } from "react"
import { Kbd, ToggleButton } from "@heroui/react"

import { PAYMENT_METHODS, type PaymentMethodOption } from "./payment-methods"
import type { PaymentSplitForm } from "./payment-splits"

/** Q W di baris atas, A S di tengah, Z di bawah — urutan tuts, bukan urutan metode. */
const METHODS_IN_KEYBOARD_ORDER = ["qris", "ewallet", "cash", "transfer", "debit"]
  .map((value) => PAYMENT_METHODS.find((method) => method.value === value))
  .filter((method): method is PaymentMethodOption => method !== undefined)

interface PaymentMethodPickerProps {
  paymentSplits: PaymentSplitForm[]
  onToggle: (method: string) => void
}

/** The method buttons of the payment dialog, one toggle per method. */
export function PaymentMethodPicker({ paymentSplits, onToggle }: PaymentMethodPickerProps) {
  const labelId = useId()

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-foreground" id={labelId}>
        Metode Pembayaran
      </p>
      {/* Disusun seperti tutsnya di papan ketik — Q W / A S / Z —
          supaya letak tombol di layar dan di tangan sama. */}
      <div aria-labelledby={labelId} className="grid grid-cols-2 gap-2" role="group">
        {METHODS_IN_KEYBOARD_ORDER.map((method) => {
          const split = paymentSplits.find((current) => current.payment_method === method.value)
          if (!split) return null

          return (
            // `ToggleButton`, bukan tombol biasa: metode yang tercentang
            // adalah keadaan, dan `aria-pressed` satu-satunya cara pembaca
            // layar tahu mana yang aktif. Klik tetap lewat `onToggle`
            // — aturan radio-lalu-tambah ada di `togglePaymentMethod`.
            <ToggleButton
              key={method.value}
              aria-keyshortcuts={`${method.shortcut} Alt+${method.shortcut}`}
              // `ToggleButton` tidak punya varian outline seperti `Button`:
              // ghost + garis tepi, yang terpilih diberi tepi aksen.
              className="w-full justify-between border border-border data-[selected=true]:border-accent"
              isSelected={split.selected}
              variant="ghost"
              onChange={() => onToggle(method.value)}
            >
              {method.label}
              {/* Petunjuk visual saja — nama tombolnya tetap label metode;
                  pembaca layar dapat tutsnya dari `aria-keyshortcuts`.
                  Satu huruf, tanpa Alt: kolom nominal itu angka, jadi
                  huruf di sana bebas dipakai. */}
              <Kbd aria-hidden="true">
                <Kbd.Content>{method.shortcut}</Kbd.Content>
              </Kbd>
            </ToggleButton>
          )
        })}
      </div>
    </div>
  )
}
