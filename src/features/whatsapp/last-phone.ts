/**
 * The last WhatsApp number a cashier sent a receipt to, remembered for the
 * rest of the browser session so the next send in the same shift does not
 * start from a blank field — most repeat customers give the same number
 * twice in a row.
 *
 * `sessionStorage` rather than `localStorage`: the number is a convenience for
 * *this* shift, not something that should outlive the tab, and the till
 * window is never closed and reopened mid-shift anyway.
 */

const KEY = "kasir.whatsapp.lastPhone"

export function getLastPhone(): string {
  try {
    return sessionStorage.getItem(KEY) ?? ""
  } catch {
    return ""
  }
}

export function setLastPhone(phone: string): void {
  try {
    sessionStorage.setItem(KEY, phone)
  } catch {
    // Private browsing or storage disabled: not remembering the number is a
    // small inconvenience, not a reason to fail the send.
  }
}
