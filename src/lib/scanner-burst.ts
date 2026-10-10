/**
 * Tells a barcode scanner from a person typing. The scanner is a keyboard: it
 * types the barcode's digits into whatever has focus in one fast burst, then
 * Enter, so a field that submits on Enter would book the barcode as a number.
 */

/** A scanner types its whole payload in one burst */
const SCANNER_MAX_INPUT_DURATION_MS = 250
/** ...and sends Enter immediately after the last digit */
export const SCANNER_MAX_ENTER_DELAY_MS = 120
/** The fewest characters a scan types; shorter runs are a cash amount or a fast hand. */
export const SCANNER_MIN_DIGITS = 6

/** The current typing burst. */
export interface ScannerBurst {
  /** What the burst typed */
  digits: string
  /** Timestamp of the burst's first keystroke, 0 when unknown */
  startedAt: number
  /** Timestamp of its last keystroke */
  lastInputAt: number
}

export const EMPTY_SCANNER_BURST: ScannerBurst = { digits: "", startedAt: 0, lastInputAt: 0 }

/**
 * Adds a keystroke typing `typed` at `now`. A gap longer than a scanner leaves
 * between keys starts a new burst.
 */
export function trackScannerBurst(
  previous: ScannerBurst,
  typed: string,
  now: number,
): ScannerBurst {
  const isNewBurst =
    previous.lastInputAt <= 0 || now - previous.lastInputAt > SCANNER_MAX_INPUT_DURATION_MS
  return isNewBurst
    ? { digits: typed, startedAt: now, lastInputAt: now }
    : { digits: previous.digits + typed, startedAt: previous.startedAt, lastInputAt: now }
}

/** Whether the burst, closed by an Enter at `submittedAt`, is a scan. */
export function isScannerBurst(
  { digits, startedAt, lastInputAt }: ScannerBurst,
  submittedAt: number,
): boolean {
  if (digits.length < SCANNER_MIN_DIGITS) return false
  if (startedAt <= 0 || lastInputAt <= 0) return false

  return (
    lastInputAt - startedAt <= SCANNER_MAX_INPUT_DURATION_MS &&
    submittedAt - lastInputAt <= SCANNER_MAX_ENTER_DELAY_MS
  )
}

type FilteredKeyEvent = Pick<
  KeyboardEvent,
  "key" | "timeStamp" | "preventDefault" | "stopPropagation"
>

interface ShortcutScanFilterOptions {
  /** Also swallow a non-scan Enter that follows a digit within a scanner's Enter delay. */
  swallowEnterAfterDigit?: boolean
}

/**
 * Feed it every keydown a field or dialog sees. It counts digits; on an Enter
 * that closes a scanner burst it swallows the Enter and returns `true`, and the
 * caller skips its own Enter handling. `onDigit` gets the burst after each digit.
 */
export function createShortcutScanFilter({
  swallowEnterAfterDigit = false,
}: ShortcutScanFilterOptions = {}) {
  let entry = EMPTY_SCANNER_BURST
  return (event: FilteredKeyEvent, onDigit?: (burst: ScannerBurst) => void): boolean => {
    if (/^\d$/.test(event.key)) {
      entry = trackScannerBurst(entry, event.key, event.timeStamp)
      onDigit?.(entry)
      return false
    }
    if (event.key !== "Enter") return false
    const burst = entry
    entry = EMPTY_SCANNER_BURST
    const isScan = isScannerBurst(burst, event.timeStamp)
    const followsDigit =
      burst.lastInputAt > 0 && event.timeStamp - burst.lastInputAt <= SCANNER_MAX_ENTER_DELAY_MS
    if (isScan || (swallowEnterAfterDigit && followsDigit)) {
      event.preventDefault()
      event.stopPropagation()
    }
    return isScan
  }
}
