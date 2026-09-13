import type { StoreInfo } from "@/features/settings/types"
import { useApiQuery } from "@/hooks/use-api"
import { getStoreInfo } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * The store row, shared by the sidebar (for the logo) and the settings screen
 * (to edit it). One key, so an upload invalidated from the settings tab is what
 * the sidebar re-reads.
 */
export function useStoreInfo() {
  return useApiQuery<StoreInfo | null>(queryKeys.settings.store, getStoreInfo)
}
