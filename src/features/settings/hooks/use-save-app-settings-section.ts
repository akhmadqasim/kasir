import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation } from "@/hooks/use-api"
import { getAppSettings, toUpdateAppSettingsInput, updateAppSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/toast"
import type { UpdateAppSettingsInput } from "../types"

/** One of the four blocks `PUT /api/settings` rewrites together. */
export type AppSettingsSection = keyof UpdateAppSettingsInput

interface SaveAppSettingsSectionOptions {
  /** Runs once the server has accepted the save: the toast, extra invalidations. */
  onSaved: () => void
}

/**
 * Save one block of the settings blob without clobbering the other three.
 *
 * `PUT /api/settings` rewrites all four blocks at once, so every save has to
 * send back the blocks it does not own. Taking them from the card's own cached
 * copy undid whatever another card, the PPOB screen or another till had saved
 * since that copy was read. Each save therefore reads the latest settings first
 * — `staleTime: 0` forces the request — and swaps in only its own block.
 */
export function useSaveAppSettingsSection<K extends AppSettingsSection>(
  section: K,
  { onSaved }: SaveAppSettingsSectionOptions,
) {
  const queryClient = useQueryClient()

  return useApiMutation<void, UpdateAppSettingsInput[K]>(
    async (value) => {
      const latest = await queryClient.fetchQuery({
        queryKey: queryKeys.settings.app,
        queryFn: getAppSettings,
        staleTime: 0,
      })
      const input: UpdateAppSettingsInput = { ...toUpdateAppSettingsInput(latest) }
      input[section] = value
      await updateAppSettings(input)
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings.app })
        onSaved()
      },
      onError: (error) => toast.error(error.message),
    },
  )
}
