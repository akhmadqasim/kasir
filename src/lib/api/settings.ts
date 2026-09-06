import type {
  AppSettings,
  DatabaseInfo,
  StoreInfo,
  UpdateAppSettingsInput,
  UpdatePpobCredentialsInput,
  UpdateStoreInfoInput,
} from "@/features/settings/types"
import { apiGet, apiPut } from "./client"

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

/** Never contains the PPOB password or PIN — only `ppob.has_credentials`. */
export function getAppSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>("/settings")
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
