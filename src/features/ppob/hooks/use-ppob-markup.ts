import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"

import { useApiQuery } from "@/hooks/use-api"
import { getPpobMarkup } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { DEFAULT_PPOB_MARKUP } from "../pricing"
import type { PpobMarkup, PpobMarkupConfig } from "../types"

/** Where the last markup the server answered with is kept, custom prices included. */
export const PPOB_MARKUP_STORAGE_KEY = "kasir-ppob-markup"

const NO_CUSTOM_PRICES: Record<string, number> = {}

function readCachedPpobMarkup(storage: Pick<Storage, "getItem"> = localStorage): PpobMarkup | null {
  try {
    const raw = storage.getItem(PPOB_MARKUP_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as PpobMarkup) : null
  } catch {
    return null
  }
}

function storeCachedPpobMarkup(
  markup: PpobMarkup,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(PPOB_MARKUP_STORAGE_KEY, JSON.stringify(markup))
  } catch {
    // Restricted storage: the live answer still prices this session.
  }
}

async function fetchAndCachePpobMarkup(): Promise<PpobMarkup> {
  const markup = await getPpobMarkup()
  storeCachedPpobMarkup(markup)
  return markup
}

/**
 * The failure already toasted, per query client, named by the query's
 * `dataUpdatedAt` — the last success before it, or 0. Every PPOB screen and
 * the cashier panel mount this hook, and a query in error refetches on each
 * mount, so keying on the failed fetch itself toasted again on every remount
 * and every screen change. Keyed on the last success, a failure speaks once
 * and stays quiet until the markup has loaded again.
 */
const reportedFailure = new WeakMap<QueryClient, number>()

interface UsePpobMarkupResult {
  /** The markup for a service: live, else the last cached copy, else fixed zero. */
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
 * Paying is never held up by it. While the request is in flight, or after it
 * fails, prices come from the last answer persisted in `localStorage`, so the
 * counter does not quietly drop to cost; only a terminal that has never loaded
 * a markup falls back to zero. A failure is reported with a toast, once until
 * the markup loads again (see `reportedFailure`). It lives under
 * `queryKeys.ppob.markup`, which the PPOB settings save invalidates (via
 * `queryKeys.ppob.all`), so a new markup applies at once.
 *
 * A service with no block of its own in `PpobMarkup` — Payment Point among
 * them — reads as a key that just isn't there, so it falls back to
 * `DEFAULT_PPOB_MARKUP`. That is configured behaviour, not a failure.
 */
export function usePpobMarkup(): UsePpobMarkupResult {
  const queryClient = useQueryClient()
  const query = useApiQuery<PpobMarkup>(queryKeys.ppob.markup, fetchAndCachePpobMarkup)
  const { isError, dataUpdatedAt } = query

  const markup = query.data ?? readCachedPpobMarkup()
  const hasFallback = markup !== null

  // Say what the price now is: with no cached copy the counter sells at cost,
  // and "memakai markup terakhir" would hide exactly that.
  useEffect(() => {
    if (!isError || reportedFailure.get(queryClient) === dataUpdatedAt) return
    reportedFailure.set(queryClient, dataUpdatedAt)
    toast.error(hasFallback ? id.loadFailed.ppobMarkupKeepLast : id.loadFailed.ppobMarkupNone)
  }, [queryClient, isError, dataUpdatedAt, hasFallback])

  const getMarkupConfig = (serviceType: string): PpobMarkupConfig => {
    if (!markup) return DEFAULT_PPOB_MARKUP
    return (
      (markup as unknown as Record<string, PpobMarkupConfig | undefined>)[serviceType] ??
      DEFAULT_PPOB_MARKUP
    )
  }

  return {
    getMarkupConfig,
    customPrices: markup?.custom_prices ?? NO_CUSTOM_PRICES,
  }
}
