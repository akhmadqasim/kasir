/**
 * `NumberField.onChange` (HeroUI, built on React Aria) reports this while its
 * input can't be parsed into a number yet — the field was just cleared, or is
 * mid-typing a lone `-`. Callers use this to decide what to do with the gap
 * (skip the update, fall back to `null`/`0`/`undefined`) without repeating the
 * two-part check. Typed as a predicate so the `false` branch narrows to
 * `number` (NaN is still a `number` to TypeScript, which is the point).
 */
export function isEmptyNumberFieldValue(value: number | undefined): value is undefined {
  return value === undefined || Number.isNaN(value)
}
