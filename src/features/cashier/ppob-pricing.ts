import type { PpobMarkupConfig } from "@/features/ppob/types/auth"

export const DEFAULT_PPOB_MARKUP: PpobMarkupConfig = { type: "fixed", value: 0 }

const MIN_NOMINAL = 1000
const MAX_NOMINAL = 1_000_000

/**
 * Candidates, in priority order at each position:
 * 1. dotted thousands ("5.000", "1.000.000")
 * 2. K-suffixed ("5K", "10 k") — not followed by another letter
 * 3. plain digits ("5000")
 */
const NOMINAL_PATTERN = /\d{1,3}(?:\.\d{3})+|(\d+)\s*[kK](?![a-zA-Z])|\d+/g

/**
 * Extract the nominal value from a PPOB product name, e.g. "Pulsa 5000",
 * "Pulsa 5.000", "Pulsa 5K" all resolve to 5000. Returns the first candidate
 * that falls inside the plausible nominal range, so quota sizes such as the
 * "1.5GB" in "Data 1.5GB 25000" are skipped.
 */
export function extractNominal(name: string): number | null {
  NOMINAL_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = NOMINAL_PATTERN.exec(name)) !== null) {
    const [raw, kDigits] = match
    const value = kDigits ? parseInt(kDigits, 10) * 1000 : parseInt(raw.replace(/\./g, ""), 10)

    if (Number.isFinite(value) && value >= MIN_NOMINAL && value <= MAX_NOMINAL) {
      return value
    }
  }

  return null
}

/**
 * Harga jual = harga modal + markup, matching the wording in PPOB settings.
 * The vendor cost is what the store actually pays, admin fee included.
 */
export function calculateSellPrice(
  vendorCost: number,
  config: PpobMarkupConfig = DEFAULT_PPOB_MARKUP,
): number {
  if (config.value <= 0) return vendorCost
  if (config.type === "fixed") return vendorCost + config.value
  return Math.round(vendorCost * (1 + config.value / 100))
}

export interface PpobSellPriceInput {
  /** Cart label of the product, used to match nominal-based custom prices */
  name: string
  serviceType: string
  /** What the store pays the vendor — bill plus admin fee for bill payments */
  vendorCost: number
  markup?: PpobMarkupConfig
  customPrices?: Record<string, number>
}

/**
 * The single source of truth for what the customer is charged: the confirmation
 * panel and the cart must both use this value.
 */
export function resolvePpobSellPrice({
  name,
  serviceType,
  vendorCost,
  markup = DEFAULT_PPOB_MARKUP,
  customPrices = {},
}: PpobSellPriceInput): number {
  const cost = Math.max(0, vendorCost)
  const nominal = serviceType === "pulsa" ? extractNominal(name) : null
  const customPrice = nominal !== null ? customPrices[String(nominal)] : undefined

  const sellPrice =
    customPrice !== undefined && customPrice > 0 ? customPrice : calculateSellPrice(cost, markup)

  // Selling below cost is always a mistake, whatever the config says.
  return Math.max(sellPrice, cost)
}
