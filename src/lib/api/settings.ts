import type {
  AppSettings,
  DatabaseInfo,
  PpobMarkup,
  StoreInfo,
  UpdateAppSettingsInput,
  UpdatePpobCredentialsInput,
  UpdateStoreInfoInput,
} from "@/features/settings/types"
import { API_BASE_URL, apiDelete, apiGet, apiPut, apiUpload } from "./client"

/**
 * Store details and application settings.
 *
 * The shop's name and address are readable by any cashier — every till needs
 * them to draw a receipt header — and writable only by an admin. The settings
 * blob is admin-only in both directions.
 */

export function getStoreInfo(): Promise<StoreInfo | null> {
  return apiGet<StoreInfo | null>("/store")
}

export function updateStoreInfo(input: UpdateStoreInfoInput): Promise<StoreInfo> {
  return apiPut<StoreInfo>("/store", input)
}

/** Never contains the PPOB password — only `ppob.has_credentials`. */
export function getAppSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>("/settings")
}

/**
 * The PPOB markup table only, open to any cashier session.
 *
 * `getAppSettings` is admin-only, but `PpobQuickAccess` is a cashier screen
 * that needs the markup to price a top-up. This hits the session-scoped
 * endpoint instead of falling back to a zero markup on a 403.
 */
export function getPpobMarkup(): Promise<PpobMarkup> {
  return apiGet<PpobMarkup>("/settings/ppob/markup")
}

/**
 * Turn what was read into what can be written.
 *
 * `PUT /api/settings` rewrites all four blocks at once, so every settings tab
 * has to send back the three it does not own. The only difference between the
 * two shapes is `ppob.has_credentials`, which is a fact about the stored
 * secrets rather than a value anything can set — dropping it here means no tab
 * has to remember that.
 */
export function toUpdateAppSettingsInput(current: AppSettings): UpdateAppSettingsInput {
  return {
    sales: current.sales,
    security: current.security,
    ppob: {
      enabled: current.ppob.enabled,
      phone_number: current.ppob.phone_number,
      device_id: current.ppob.device_id,
      markup: current.ppob.markup,
    },
    backup: current.backup,
  }
}

/**
 * Save everything except the PPOB credentials. Those are kept as they were, so
 * saving a markup change cannot blank them.
 */
export function updateAppSettings(input: UpdateAppSettingsInput): Promise<void> {
  return apiPut<void>("/settings", input)
}

export function updatePpobCredentials(input: UpdatePpobCredentialsInput): Promise<void> {
  return apiPut<void>("/settings/ppob/credentials", input)
}

/** Size and location of the live database file, for an admin to find it on the till. */
export function getDatabaseInfo(): Promise<DatabaseInfo> {
  return apiGet<DatabaseInfo>("/settings/database")
}

/**
 * Replace the store logo. The server decides the format from the bytes, so
 * nothing about the `File` beyond its content matters; a file that is not a
 * PNG, JPEG, WebP or SVG under 1 MB comes back as a `validation` error.
 */
export function uploadStoreLogo(file: File): Promise<StoreInfo> {
  return apiUpload<StoreInfo>("/settings/store/logo", file)
}

export function deleteStoreLogo(): Promise<void> {
  return apiDelete<void>("/settings/store/logo")
}

/**
 * Where the logo image is, or `null` when the store has none.
 *
 * `updated_at` rides along as a cache-buster: the path never changes, so
 * without it a browser that cached yesterday's logo would keep showing it
 * after an upload. The URL is same-origin and the session cookie travels with
 * an `<img>` request, so this can be used as a plain `src`.
 */
export function storeLogoUrl(
  store: Pick<StoreInfo, "logo_path" | "updated_at"> | null,
): string | null {
  if (!store?.logo_path) return null
  return `${API_BASE_URL}/store/logo?v=${encodeURIComponent(store.updated_at ?? "")}`
}
