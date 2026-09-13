import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import {
  getAppSettings,
  toUpdateAppSettingsInput,
  updateAppSettings,
  updatePpobCredentials,
} from "@/lib/api/settings"
import { openPpobSession } from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import type { AppSettings, PpobMarkup, PpobMarkupConfig } from "@/features/settings/types"
import type { PpobSaldoResponse } from "../../types"

const DEFAULT_MARKUP_CONFIG: PpobMarkupConfig = { type: "fixed", value: 0 }

const DEFAULT_MARKUP: PpobMarkup = {
  pulsa: { ...DEFAULT_MARKUP_CONFIG },
  data: { ...DEFAULT_MARKUP_CONFIG },
  pln: { ...DEFAULT_MARKUP_CONFIG },
  pdam: { ...DEFAULT_MARKUP_CONFIG },
  bpjs: { ...DEFAULT_MARKUP_CONFIG },
  emoney: { ...DEFAULT_MARKUP_CONFIG },
  custom_prices: {},
}

export interface PpobConnectionFields {
  enabled: boolean
  phoneNumber: string
  password: string
  deviceId: string
  pin: string
}

const EMPTY_CONNECTION: PpobConnectionFields = {
  enabled: false,
  phoneNumber: "",
  password: "",
  deviceId: "",
  pin: "",
}

export interface PpobSettingsForm {
  connection: PpobConnectionFields
  updateConnection: (patch: Partial<PpobConnectionFields>) => void
  markup: PpobMarkup
  updateMarkup: (update: (prev: PpobMarkup) => PpobMarkup) => void
  /** Whether a password and PIN are stored — all the server ever says about them. */
  hasStoredCredentials: boolean
  /** False until `GET /settings` has answered; the save buttons stay dead until then. */
  isReady: boolean
  save: () => void
  isSaving: boolean
  testConnection: () => void
  isTesting: boolean
}

/**
 * State and both mutations behind the Mitra Indogrosir settings screen, shared
 * by its connection and markup cards so that either card's Simpan writes the
 * whole form.
 */
export function usePpobSettingsForm(): PpobSettingsForm {
  const queryClient = useQueryClient()
  const [connection, setConnection] = useState<PpobConnectionFields>(EMPTY_CONNECTION)
  const [markup, setMarkup] = useState<PpobMarkup>(DEFAULT_MARKUP)
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  /**
   * The password and the PIN are never sent back by the server, so the two
   * fields start empty every time and mean "leave what is stored alone".
   * `has_credentials` is all this screen can know about them — enough to say
   * whether any are stored, which is the only question an admin actually asks.
   */
  const hasStoredCredentials = settingsQuery.data?.ppob.has_credentials ?? false

  if (settingsQuery.data && !initialized) {
    const { ppob } = settingsQuery.data
    if (ppob) {
      setConnection((prev) => ({
        ...prev,
        enabled: ppob.enabled,
        phoneNumber: ppob.phone_number,
        deviceId: ppob.device_id,
      }))
      if (ppob.markup) {
        setMarkup({ ...DEFAULT_MARKUP, ...ppob.markup })
      }
    }
    setInitialized(true)
  }

  const saveMutation = useApiMutation<void, void>(
    async () => {
      // The server rewrites all four blocks at once, so posting hardcoded
      // defaults for the blocks this screen does not own would silently reset them.
      const currentSettings = settingsQuery.data
      if (!currentSettings) {
        throw new Error("Pengaturan belum dimuat, coba lagi sebentar")
      }

      // Credentials travel on their own request, and only when both were typed.
      // `PUT /api/settings` cannot carry them at all, which is what stops a
      // markup change from blanking a password by omission — the failure mode
      // the old single-blob save had every time this form loaded before the
      // query resolved.
      const { password, pin } = connection
      const wantsCredentialChange = password.length > 0 || pin.length > 0
      if (wantsCredentialChange && (password.length === 0 || pin.length === 0)) {
        throw new Error("Isi password dan PIN sekaligus untuk menggantinya")
      }

      await updateAppSettings({
        ...toUpdateAppSettingsInput(currentSettings),
        ppob: {
          enabled: connection.enabled,
          phone_number: connection.phoneNumber,
          device_id: connection.deviceId,
          markup,
        },
      })

      if (wantsCredentialChange) {
        await updatePpobCredentials({ password, pin })
      }
    },
    {
      onSuccess: () => {
        setConnection((prev) => ({ ...prev, password: "", pin: "" }))
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.app })
        // New credentials mean a different upstream account, so the cached
        // balance is no longer about the same shop.
        queryClient.invalidateQueries({ queryKey: queryKeys.ppob.all })
        toast.success(id.ppob.settingsSaved)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    },
  )

  const testMutation = useApiMutation<PpobSaldoResponse, void>(openPpobSession, {
    onSuccess: (result) => {
      toast.success(
        `${id.ppob.testConnectionSuccess}: ${result.username} (Saldo: Rp ${result.saldo.toLocaleString("id-ID")})`,
      )
    },
    onError: (error) => {
      toast.error(`${id.ppob.testConnectionFailed}: ${error.message}`)
    },
  })

  return {
    connection,
    updateConnection: (patch) => setConnection((prev) => ({ ...prev, ...patch })),
    markup,
    updateMarkup: setMarkup,
    hasStoredCredentials,
    isReady: settingsQuery.isSuccess && initialized,
    save: () => saveMutation.mutate(undefined),
    isSaving: saveMutation.isPending,
    testConnection: () => testMutation.mutate(undefined),
    isTesting: testMutation.isPending,
  }
}
