export type ProductSearchEnterAction =
  | "ignore"
  | "select-active-result"
  | "lookup-exact-barcode"
  | "wait-for-search"
  | "show-not-found"

interface ProductSearchEnterState {
  query: string
  debouncedQuery: string
  resultCount: number
  hasSearchData: boolean
}

interface BarcodeInputTiming {
  query: string
  startedAt: number
  lastInputAt: number
  submittedAt: number
}

interface SearchableProduct {
  barcode: string | null
  sku: string | null
  name: string
}

const SCANNER_MAX_INPUT_DURATION_MS = 250
const SCANNER_MAX_ENTER_DELAY_MS = 120

export function isBarcodeScannerCandidate(query: string): boolean {
  return /^\d{6,}$/.test(query.trim())
}

/** Digit counts a real barcode has: EAN-8/UPC-E, UPC-A, EAN-13, ITF-14. */
const WHOLE_BARCODE_LENGTHS = new Set([8, 12, 13, 14])

/**
 * `true` when a digit run is long enough to be a *whole* barcode, so a miss on
 * the exact lookup really does mean "this code does not exist".
 *
 * Any other length is a partial code — the tail of a barcode read off a worn
 * label — and only the debounced list search resolves a tail, because
 * `get_by_barcode` matches exactly. Announcing "tidak ditemukan" for one of
 * those would clear the field and abort the search that was about to answer it.
 *
 * Deliberately not the same rule as `is_partial_barcode` in
 * `src-tauri/src/services/products.rs`: that one decides how wide to cast the
 * SQL net, this one decides whether a scan may be declared dead on the spot.
 * They answer different questions and do not have to agree digit for digit.
 */
export function isWholeBarcodeQuery(query: string): boolean {
  const trimmed = query.trim()
  return /^\d+$/.test(trimmed) && WHOLE_BARCODE_LENGTHS.has(trimmed.length)
}

export function isLikelyBarcodeScannerInput({
  query,
  startedAt,
  lastInputAt,
  submittedAt,
}: BarcodeInputTiming): boolean {
  const trimmedQuery = query.trim()

  if (!isBarcodeScannerCandidate(trimmedQuery)) return false
  if (startedAt <= 0 || lastInputAt <= 0) return false

  return (
    lastInputAt - startedAt <= SCANNER_MAX_INPUT_DURATION_MS &&
    submittedAt - lastInputAt <= SCANNER_MAX_ENTER_DELAY_MS
  )
}

export function getProductSearchEnterAction({
  query,
  debouncedQuery,
  resultCount,
  hasSearchData,
}: ProductSearchEnterState): ProductSearchEnterAction {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return "ignore"

  const isCurrentSearch = debouncedQuery.trim() === trimmedQuery

  if (isCurrentSearch && resultCount > 0) {
    return "select-active-result"
  }

  if (isBarcodeScannerCandidate(trimmedQuery)) {
    return "lookup-exact-barcode"
  }

  if (!isCurrentSearch || !hasSearchData) {
    return "wait-for-search"
  }

  return "show-not-found"
}

function getSearchRank(product: SearchableProduct, normalizedQuery: string): number {
  const barcode = product.barcode?.toLowerCase() ?? ""
  const sku = product.sku?.toLowerCase() ?? ""
  const name = product.name.toLowerCase()

  if (barcode === normalizedQuery) return 0
  if (barcode.startsWith(normalizedQuery)) return 1
  // The backend matches the tail of a barcode so a cashier can type the last
  // digits off a worn label. Those hits are deliberate, not incidental, so they
  // outrank a code that merely happens to contain the digits somewhere.
  if (barcode.endsWith(normalizedQuery)) return 2
  if (barcode.includes(normalizedQuery)) return 3
  if (sku === normalizedQuery) return 4
  if (sku.startsWith(normalizedQuery)) return 5
  if (sku.includes(normalizedQuery)) return 6
  if (name.startsWith(normalizedQuery)) return 7
  if (name.includes(normalizedQuery)) return 8

  return 9
}

export function rankProductsForSearch<T extends SearchableProduct>(
  products: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) return products

  return [...products].sort((a, b) => {
    const rankDiff = getSearchRank(a, normalizedQuery) - getSearchRank(b, normalizedQuery)

    if (rankDiff !== 0) return rankDiff

    return a.name.localeCompare(b.name, "id")
  })
}
