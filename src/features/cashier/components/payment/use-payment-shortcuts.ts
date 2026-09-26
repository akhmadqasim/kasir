import { useEffect, useMemo, useRef, useState } from "react"

import {
  PAYMENT_METHODS,
  findMethodByShortcut,
  isPinField,
  isTypingTarget,
} from "./payment-methods"

/** React Aria moves focus to the dialog as it opens; ours has to land after that. */
const OPEN_FOCUS_DELAY_MS = 100

function focusAndSelect(input: HTMLInputElement | null | undefined) {
  input?.focus()
  input?.select()
}

interface UsePaymentShortcutsArgs {
  open: boolean
  /** The method this opening of the dialog started on. */
  openedOn: string
  isSingleCashSelection: boolean
  /** Fill cash with exactly the total ("uang pas"). */
  onExactCash: () => void
  /** Toggle `method` like a click on its button; returns the method now active. */
  onToggleMethod: (method: string) => string
}

/**
 * Where the cashier's cursor goes in the payment dialog, and the keys that
 * work from anywhere in it: a method's letter, and ` for exact cash.
 * Returns the callback refs the amount fields attach themselves with.
 */
export function usePaymentShortcuts({
  open,
  openedOn,
  isSingleCashSelection,
  onExactCash,
  onToggleMethod,
}: UsePaymentShortcutsArgs) {
  // One ref per method's amount field, so a shortcut can land the cursor in
  // the field it just revealed.
  const amountInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [focusRequest, setFocusRequest] = useState<{ method: string; seq: number } | null>(null)

  // Auto-focus the cash amount when the dialog opens. `setTimeout` runs it
  // after React Aria has focused the dialog itself, not before, or it would
  // be overwritten straight away.
  useEffect(() => {
    if (open && isSingleCashSelection) {
      setTimeout(() => amountInputRefs.current.cash?.focus(), OPEN_FOCUS_DELAY_MS)
    }
  }, [isSingleCashSelection, open])

  // The same for a non-cash default: its amount field is the one to type in
  // (or press Enter on — it already holds the total).
  useEffect(() => {
    if (!open || openedOn === "cash") return
    const timer = setTimeout(
      () => focusAndSelect(amountInputRefs.current[openedOn]),
      OPEN_FOCUS_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [open, openedOn])

  // ` (backtick) anywhere in the dialog: cash for exactly the total ("uang
  // pas" without touching the mouse), then focus and select it so the next
  // Enter pays.
  useEffect(() => {
    if (!open || !isSingleCashSelection) return

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== "`" && event.code !== "Backquote") return
      // Notes are free text, and the PIN must not have the cash split
      // overwritten while the cashier is in the middle of typing it.
      if (event.target instanceof HTMLTextAreaElement || isPinField(event.target)) return

      event.preventDefault()
      onExactCash()
      focusAndSelect(amountInputRefs.current.cash)
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [isSingleCashSelection, onExactCash, open])

  // <letter> (or Alt+<letter>) toggles a method exactly like a click on its
  // button, then asks for the cursor to land in the active method's amount
  // field — see the effect below. Without that, toggling away from Tunai
  // unmounted the very field that had focus, and the cashier's next Enter
  // went nowhere.
  useEffect(() => {
    if (!open) return

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.repeat) return
      const method = findMethodByShortcut(event.key)
      if (!method) return
      if (!event.altKey && isTypingTarget(event.target)) return

      event.preventDefault()
      const next = onToggleMethod(method.value)
      setFocusRequest((previous) => ({ method: next, seq: (previous?.seq ?? 0) + 1 }))
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [onToggleMethod, open])

  // Runs after the render a shortcut caused, so the field it wants is mounted
  // by the time it looks for it. The request names its method rather than
  // reading the active one: that also changes when the cashier clicks into a
  // bank field, and the click must not have its focus taken away.
  useEffect(() => {
    if (!focusRequest) return
    focusAndSelect(amountInputRefs.current[focusRequest.method])
  }, [focusRequest])

  // Callback refs, one per method and stable across renders, for the amount
  // fields to attach themselves to.
  const registerAmountInput = useMemo(() => {
    const refs: Record<string, (element: HTMLInputElement | null) => void> = {}
    for (const method of PAYMENT_METHODS) {
      refs[method.value] = (element) => {
        amountInputRefs.current[method.value] = element
      }
    }
    return (method: string) => refs[method]
  }, [])

  return { registerAmountInput }
}
