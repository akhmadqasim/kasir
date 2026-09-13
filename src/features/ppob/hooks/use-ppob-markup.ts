import { useEffect, useState } from "react"

import { getPpobMarkup } from "@/lib/api/settings"
import { DEFAULT_PPOB_MARKUP } from "../pricing"
import type { PpobMarkup, PpobMarkupConfig } from "../types"

export interface UsePpobMarkupResult {
  /** The shop's configured markup for a service, or the fixed-zero default it falls back to. */
  getMarkupConfig: (serviceType: string) => PpobMarkupConfig
  customPrices: Record<string, number>
}

/**
 * The shop's PPOB markup, which is what turns the provider's cost into the
 * price on the counter.
 *
 * Fetched from the session-scoped `/settings/ppob/markup` endpoint rather
 * than `/settings`, which is admin-only. `/settings` used to be the only
 * source and 403'd for a cashier, silently falling back to
 * `DEFAULT_PPOB_MARKUP` — zero — so every top-up sold at cost.
 *
 * A service with no block of its own in `PpobMarkup` — Payment Point among
 * them — reads as a key that just isn't there, so it falls back to
 * `DEFAULT_PPOB_MARKUP` the same way a fetch failure does.
 */
export function usePpobMarkup(): UsePpobMarkupResult {
  const [markup, setMarkup] = useState<PpobMarkup | null>(null)
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({})

  useEffect(() => {
    getPpobMarkup()
      .then((markup) => {
        setMarkup(markup)
        if (markup.custom_prices) {
          setCustomPrices(markup.custom_prices)
        }
      })
      .catch(() => {})
  }, [])

  const getMarkupConfig = (serviceType: string): PpobMarkupConfig => {
    if (!markup) return DEFAULT_PPOB_MARKUP
    return (
      (markup as unknown as Record<string, PpobMarkupConfig>)[serviceType] ?? DEFAULT_PPOB_MARKUP
    )
  }

  return { getMarkupConfig, customPrices }
}
