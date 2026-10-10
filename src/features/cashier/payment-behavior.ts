/**
 * Guards against a barcode scanner committing a sale. The scanner is a keyboard:
 * while the payment dialog traps focus in the cash amount input, a scan types the
 * barcode digits into that field and ends with Enter.
 *
 * Telling a scan from typing is shared with the rest of the app and lives in
 * `@/lib/scanner-burst`; this module keeps the payment-only ceiling.
 */

/** Rp 100 juta — well above any single sembako sale, well below a scanned EAN-13 */
export const MAX_PAYMENT_AMOUNT = 100_000_000

export function isImplausiblePaymentAmount(amount: number): boolean {
  return amount > MAX_PAYMENT_AMOUNT
}
