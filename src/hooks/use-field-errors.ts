import { useCallback, useState } from "react"

/**
 * Per-field validation messages for a form that validates itself on submit
 * (`validationBehavior="aria"`).
 *
 * A field's message goes as soon as that field is edited, not on the next
 * submit — otherwise the fixed field keeps shouting until the form is sent
 * again, and the person cannot tell whether the fix was taken.
 *
 * - `setErrors` replaces the whole set after a validation pass (or adds one
 *   message by updater, e.g. "out of stock" the moment a product is picked).
 * - `clearError(field)` drops one message; a no-op when it has none.
 * - `edit(field, setter)` wraps a text field's setter so editing it does both.
 */
export function useFieldErrors<TField extends string>() {
  const [errors, setErrors] = useState<Partial<Record<TField, string>>>({})

  const clearError = useCallback((field: TField) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const edit =
    <TValue>(field: TField, setter: (value: TValue) => void) =>
    (value: TValue) => {
      setter(value)
      clearError(field)
    }

  return { errors, setErrors, clearError, edit }
}
