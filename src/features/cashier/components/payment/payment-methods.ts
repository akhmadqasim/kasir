import {
  SELECTABLE_PAYMENT_METHODS,
  isSelectablePaymentMethod,
  paymentMethodLabel,
  type SelectablePaymentMethod,
} from "@/lib/labels"

/**
 * `shortcut` is the letter that toggles the method — a bare letter, because
 * the till is a keyboard and the cashier's left hand rests on Q/W/A/S/Z
 * while the right one is on the numpad. It fires from anywhere in the
 * dialog except a field that takes typing (bank, notes, PIN): the amount
 * fields are numeric, so a letter typed into one has no other meaning.
 * Alt+<letter> still works for anyone who learnt it that way. Not Ctrl,
 * because Ctrl+A/S/W already mean select-all/save/close-tab to the webview.
 */
const METHOD_SHORTCUTS: Record<SelectablePaymentMethod, string> = {
  cash: "A",
  qris: "Q",
  debit: "Z",
  ewallet: "W",
  transfer: "S",
}

/** Every method the dialog offers, with the label the rest of the app uses. */
export const PAYMENT_METHODS = SELECTABLE_PAYMENT_METHODS.map((value) => ({
  value,
  label: paymentMethodLabel(value),
  shortcut: METHOD_SHORTCUTS[value],
}))

export type PaymentMethodOption = (typeof PAYMENT_METHODS)[number]

export const QUICK_AMOUNT_OPTIONS = [5000, 10000, 20000, 50000, 100000] as const

/**
 * The PIN field's `name`, so the global shortcuts can tell it apart from every
 * other field without a ref — `usePaymentForm` returning one more ref
 * alongside the amount refs is what trips the `react-hooks/refs` lint rule
 * across the dialog's JSX.
 */
export const PPOB_PIN_FIELD_NAME = "ppob_pin"

/**
 * The method the dialog opens on: Pengaturan → Penjualan's "Metode Pembayaran
 * Default", or cash when it is unset, not one this dialog offers, or not
 * loaded (yet).
 */
export function resolveDefaultPaymentMethod(configured: string | null | undefined): string {
  return isSelectablePaymentMethod(configured) ? configured : "cash"
}

/** The method whose bare-letter (or Alt+letter) shortcut is `key`, if any. */
export function findMethodByShortcut(key: string): PaymentMethodOption | undefined {
  return PAYMENT_METHODS.find((method) => method.shortcut === key.toUpperCase())
}

/**
 * A field the cashier types words into. A bare-letter shortcut must not fire
 * from one of these — the bank field would lose the "A" in "BCA" to Tunai.
 * Amount fields are numeric (`inputmode="numeric"`), so a letter there is
 * free to mean the method; the PIN field is numeric too but is excluded by
 * name, the same way the Uang Pas shortcut excludes it.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  if (isPinField(target)) return true
  if (!(target instanceof HTMLInputElement)) return false
  return target.getAttribute("inputmode") !== "numeric"
}

/** The PIN is typed digit by digit like an amount, but it is not one. */
export function isPinField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.name === PPOB_PIN_FIELD_NAME
}
