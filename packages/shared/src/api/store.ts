import type { PublicStoreInfo } from "../types/store"
import type { ApiClient } from "./client"

/**
 * What the login screen may know about the shop: its name, and whether it has a
 * logo. Both endpoints are public on the server — they answer before anyone has
 * signed in, which is the whole point.
 */
export function createStoreApi(client: ApiClient) {
  return {
    /**
     * `null` before onboarding: there is no store yet, and the login screen
     * falls back to its generic title.
     */
    getPublicStoreInfo(): Promise<PublicStoreInfo | null> {
      return client.get<PublicStoreInfo | null>("/store/public", undefined, {
        handleUnauthorized: false,
      })
    },
  }
}

export type StoreApi = ReturnType<typeof createStoreApi>

/**
 * Where the store logo is, or `null` when there is none to show.
 *
 * `apiBase` is the API root without a trailing slash (`http://host:port/api`).
 * The path never changes when a logo is replaced, so `version` — when the public
 * slice was fetched — rides along to bust an image cache that would otherwise
 * keep yesterday's logo. Same rule as the desktop's `publicStoreLogoUrl`.
 */
export function publicStoreLogoUrl(
  apiBase: string,
  store: PublicStoreInfo | null | undefined,
  version: number | string,
): string | null {
  if (!store?.has_logo) return null
  return `${apiBase.replace(/\/+$/, "")}/store/logo?v=${encodeURIComponent(String(version))}`
}
