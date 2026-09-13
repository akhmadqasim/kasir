import type { KeyboardEvent, Ref } from "react"
import { FieldError, Input, Label, TextField } from "@heroui/react"

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
  /** A validation message from the form, shown under the field when set. */
  errorMessage?: string
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  /** Focus the field as soon as it mounts — a dialog's one obvious first field. */
  autoFocus?: boolean
  /** The underlying `<input>`, for a caller that needs to re-focus it later
   * (a keyboard shortcut that fills the field and hands focus back to it). */
  ref?: Ref<HTMLInputElement>
}

/** `-10.000` → -10000; digits only, one optional leading minus. */
function parseTyped(text: string, allowNegative: boolean): number | null {
  const negative = allowNegative && text.trimStart().startsWith("-")
  const digits = text.replace(/\D/g, "")
  if (digits === "") return null
  const magnitude = Number(digits)
  return negative ? -magnitude : magnitude
}

/**
 * A stored amount can carry a fraction (`buy_price` is a REAL and the import
 * accepts one); it is rounded here because the field only takes digits, and
 * `1.250,5` re-parsed after one more keystroke would read as `12.505x`.
 */
function formatTyped(value: number | null): string {
  if (value == null) return ""
  const whole = Math.round(Math.abs(value))
  return value < 0 ? `-${formatNumber(whole)}` : formatNumber(whole)
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
  errorMessage,
  className,
  onKeyDown,
  onFocus,
  autoFocus,
  ref,
}: RupiahFieldProps) {
  return (
    <TextField
      className={className}
      fullWidth
      inputMode="numeric"
      isDisabled={isDisabled}
      isInvalid={Boolean(errorMessage)}
      value={formatTyped(value)}
      variant="secondary"
      onChange={(text) => onChange(parseTyped(text, allowNegative))}
    >
      <Label>{label}</Label>
      <Input
        ref={ref}
        autoFocus={autoFocus}
        className="text-right tabular-nums"
        placeholder={placeholder}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </TextField>
  )
}
