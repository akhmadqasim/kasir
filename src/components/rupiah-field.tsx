import type { KeyboardEvent } from "react"
import { Input, Label, TextField } from "@heroui/react"

import { formatNumber } from "@/lib/format"

interface RupiahFieldProps {
  label: string
  /** Whole rupiah; `null` when the field is empty. */
  value: number | null
  onChange: (value: number | null) => void
  /** Whether a leading minus is accepted (a discount). */
  allowNegative?: boolean
  /** Shown while the field is empty. */
  placeholder?: string
  isDisabled?: boolean
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}

/** `-10.000` → -10000; digits only, one optional leading minus. */
function parseTyped(text: string, allowNegative: boolean): number | null {
  const negative = allowNegative && text.trimStart().startsWith("-")
  const digits = text.replace(/\D/g, "")
  if (digits === "") return null
  const magnitude = Number(digits)
  return negative ? -magnitude : magnitude
}

function formatTyped(value: number | null): string {
  if (value == null) return ""
  return value < 0 ? `-${formatNumber(-value)}` : formatNumber(value)
}

/**
 * A rupiah amount that groups its thousands as it is typed: `10000` shows as
 * `10.000` on the fifth keystroke, not on blur. React Aria's NumberField only
 * formats once the field loses focus, which on a till reads like the number
 * changing under the cashier's hand.
 *
 * The caret is kept at the end, where a person typing an amount already has
 * it; editing the middle of a number is not what this field is for.
 */
export function RupiahField({
  label,
  value,
  onChange,
  allowNegative = false,
  placeholder,
  isDisabled,
  className,
  onKeyDown,
}: RupiahFieldProps) {
  return (
    <TextField
      className={className}
      fullWidth
      inputMode="numeric"
      isDisabled={isDisabled}
      value={formatTyped(value)}
      variant="secondary"
      onChange={(text) => onChange(parseTyped(text, allowNegative))}
    >
      <Label>{label}</Label>
      <Input className="text-right tabular-nums" placeholder={placeholder} onKeyDown={onKeyDown} />
    </TextField>
  )
}
