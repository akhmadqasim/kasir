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
  if (barcode.includes(normalizedQuery)) return 2
  if (sku === normalizedQuery) return 3
  if (sku.startsWith(normalizedQuery)) return 4
  if (sku.includes(normalizedQuery)) return 5
  if (name.startsWith(normalizedQuery)) return 6
  if (name.includes(normalizedQuery)) return 7

  return 8
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
