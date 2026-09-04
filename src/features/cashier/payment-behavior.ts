/**
 * Guards against a barcode scanner committing a sale. The scanner is a keyboard:
 * while the payment dialog traps focus in the cash amount input, a scan types the
 * barcode digits into that field and ends with Enter.
 */

/** Rp 100 juta — well above any single sembako sale, well below a scanned EAN-13 */
export const MAX_PAYMENT_AMOUNT = 100_000_000

/** A scanner types its whole payload in one burst */
const SCANNER_MAX_INPUT_DURATION_MS = 250
/** ...and sends Enter immediately after the last digit */
const SCANNER_MAX_ENTER_DELAY_MS = 120
/** Shortest retail barcode (EAN-8); shorter values are plausible cash amounts */
const SCANNER_MIN_DIGITS = 6

export interface PaymentAmountEntry {
  /** Raw digits currently in the amount field */
  amount: string
  /** Timestamp of the first keystroke of the current burst, 0 when unknown */
  startedAt: number
  /** Timestamp of the last keystroke */
  lastInputAt: number
  /** Timestamp of the Enter key */
  submittedAt: number
}

export function isScannerBurstEntry({
  amount,
  startedAt,
  lastInputAt,
  submittedAt,
}: PaymentAmountEntry): boolean {
  if (amount.length < SCANNER_MIN_DIGITS) return false
  if (startedAt <= 0 || lastInputAt <= 0) return false

  return (
    lastInputAt - startedAt <= SCANNER_MAX_INPUT_DURATION_MS &&
    submittedAt - lastInputAt <= SCANNER_MAX_ENTER_DELAY_MS
  )
}

export function isImplausiblePaymentAmount(amount: number): boolean {
  return amount > MAX_PAYMENT_AMOUNT
}

export interface AmountEntryTiming {
  startedAt: number
  lastInputAt: number
}

export const EMPTY_AMOUNT_ENTRY_TIMING: AmountEntryTiming = {
  startedAt: 0,
  lastInputAt: 0,
}

/**
 * Keeps the start of the current typing burst. A gap longer than a scanner's
 * keystroke interval means the cashier is typing, so the burst restarts.
 */
export function trackAmountEntry(
  previous: AmountEntryTiming,
  now: number
): AmountEntryTiming {
  const isNewBurst =
    previous.lastInputAt <= 0 ||
    now - previous.lastInputAt > SCANNER_MAX_INPUT_DURATION_MS

  return {
    startedAt: isNewBurst ? now : previous.startedAt,
    lastInputAt: now,
  }
}
