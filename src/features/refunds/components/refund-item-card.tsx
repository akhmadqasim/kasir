import { Checkbox, Description, Label, NumberField, Surface } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import {
  isDiscountedLine,
  lineDiscountAmount,
  netAmountForQuantity,
  netLineAmount,
  netUnitAmount,
} from "@/lib/line-amounts"
import type { TransactionDetailItem } from "@/features/transactions/types"
import type { RefundItemState } from "../hooks/use-refund-form"
import { REFUND_CONDITION_OPTIONS, isRefundCondition } from "../labels"

interface RefundItemCardProps {
  item: TransactionDetailItem
  state: RefundItemState | undefined
  onUpdate: (updates: Partial<RefundItemState>) => void
}

/** One sold line: tick it to return it, then pick how many and in what condition. */
export function RefundItemCard({ item, state, onUpdate }: RefundItemCardProps) {
  if (!state) return null

  const isFullyRefunded = state.maxQty <= 0

  return (
    // Permukaan bertingkat di dalam panel; kotak centangnya sendiri yang
    // menandai baris terpilih, bukan garis tepi warna merek tambahan.
    <Surface className="p-3" variant="secondary">
      <Checkbox
        isDisabled={isFullyRefunded}
        isSelected={state.checked}
        variant="secondary"
        onChange={(isSelected) => onUpdate({ checked: isSelected })}
      >
        {/* Labelnya dua-tiga baris, jadi kontrolnya rata atas. `w-full`: tanpa
            itu label selebar teksnya dan nominal terpilih menempel di nama
            barang, bukan rata kanan. */}
        <Checkbox.Content className="w-full items-start">
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <div className="grid flex-1 gap-0.5 text-left">
            <span>{item.product_name}</span>
            <span className="text-xs text-muted tabular-nums">
              {formatRupiah(netUnitAmount(item))} × {item.quantity} ={" "}
              {formatRupiah(netLineAmount(item))}
            </span>
            {isDiscountedLine(item) && (
              <span className="text-xs text-muted">
                Harga daftar {formatRupiah(item.product_price)}, sudah dipotong diskon{" "}
                {formatRupiah(lineDiscountAmount(item))}
              </span>
            )}
            {isFullyRefunded ? (
              <span className="text-xs text-muted">{id.refund.fullyRefunded}</span>
            ) : item.refunded_quantity > 0 ? (
              <span className="text-xs text-muted tabular-nums">
                {id.refund.alreadyRefunded(item.refunded_quantity, state.maxQty)}
              </span>
            ) : null}
          </div>
          {state.checked && (
            <span className="font-medium tabular-nums whitespace-nowrap text-foreground">
              {formatRupiah(netAmountForQuantity(item, state.quantity))}
            </span>
          )}
        </Checkbox.Content>
      </Checkbox>

      {state.checked && (
        // `ps-7` menyejajarkan kolom isian dengan teks label di sebelah kotak centang.
        // Dua kolom sama lebar; batas qty turun ke Description supaya labelnya
        // tidak patah jadi dua baris di panel yang sempit (layar 1024px).
        <div className="mt-3 grid grid-cols-2 items-start gap-3 ps-7">
          <NumberField
            fullWidth
            maxValue={state.maxQty}
            minValue={1}
            value={state.quantity}
            variant="secondary"
            onChange={(quantity) => {
              if (quantity === undefined || Number.isNaN(quantity)) return
              onUpdate({ quantity })
            }}
          >
            <Label>{id.refund.refundQty}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="text-center tabular-nums" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <Description className="tabular-nums">Maks. {state.maxQty}</Description>
          </NumberField>

          <OptionSelect
            fullWidth
            label={id.refund.condition}
            options={REFUND_CONDITION_OPTIONS}
            value={state.condition}
            variant="secondary"
            onChange={(key) => {
              if (isRefundCondition(key)) onUpdate({ condition: key })
            }}
          />
        </div>
      )}
    </Surface>
  )
}
