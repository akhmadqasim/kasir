/**
 * `NumberField.onChange` (HeroUI, built on React Aria) reports this while its
 * input can't be parsed into a number yet — the field was just cleared, or is
 * mid-typing a lone `-`. Callers use this to decide what to do with the gap
 * (skip the update, fall back to `null`/`0`/`undefined`) without repeating the
 * two-part check.
 */
export function isEmptyNumberFieldValue(value: number | undefined): boolean {
  return value === undefined || Number.isNaN(value)
}
