import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Save, RefreshCw } from "lucide-react"
import {
  Button,
  Card,
  Description,
  Fieldset,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Separator,
  Switch,
  TextField,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { selectedText } from "@/components/selected-text"
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
import type { PpobSaldoResponse } from "@/features/ppob/types"
import type { AppSettings, PpobMarkup, PpobMarkupConfig } from "../types"
import { PpobCustomPrices } from "./ppob-custom-prices"

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

type MarkupServiceKey = "pulsa" | "data" | "pln" | "pdam" | "bpjs" | "emoney"

const MARKUP_SERVICES: { key: MarkupServiceKey; label: string }[] = [
  { key: "pulsa", label: "Pulsa" },
  { key: "data", label: "Data" },
  { key: "pln", label: "PLN" },
  { key: "pdam", label: "PDAM" },
  { key: "bpjs", label: "BPJS" },
  { key: "emoney", label: "E-Money" },
]

const MARKUP_TYPES = [
  { key: "fixed", label: "Nominal (Rp)" },
  { key: "percentage", label: "Persentase (%)" },
] as const

export function PpobSettingsTab() {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState("")
  const [password, setPassword] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [pin, setPin] = useState("")
  const [markup, setMarkup] = useState<PpobMarkup>(DEFAULT_MARKUP)
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  /**
   * The password and the PIN are never sent back by the server, so the two
   * fields below start empty every time and mean "leave what is stored alone".
   * `has_credentials` is all this screen can know about them — enough to say
   * whether any are stored, which is the only question an admin actually asks.
   */
  const hasStoredCredentials = settingsQuery.data?.ppob.has_credentials ?? false

  if (settingsQuery.data && !initialized) {
    const { ppob } = settingsQuery.data
    if (ppob) {
      setEnabled(ppob.enabled)
      setPhoneNumber(ppob.phone_number)
      setDeviceId(ppob.device_id)
      if (ppob.markup) {
        setMarkup({ ...DEFAULT_MARKUP, ...ppob.markup })
      }
    }
    setInitialized(true)
  }

  const saveMutation = useApiMutation<void, void>(
    async () => {
      // The server rewrites all four blocks at once, so posting hardcoded
      // defaults for the blocks this tab does not own would silently reset them.
      const currentSettings = settingsQuery.data
      if (!currentSettings) {
        throw new Error("Pengaturan belum dimuat, coba lagi sebentar")
      }

      // Credentials travel on their own request, and only when both were typed.
      // `PUT /api/settings` cannot carry them at all, which is what stops a
      // markup change from blanking a password by omission — the failure mode
      // the old single-blob save had every time this form loaded before the
      // query resolved.
      const wantsCredentialChange = password.length > 0 || pin.length > 0
      if (wantsCredentialChange && (password.length === 0 || pin.length === 0)) {
        throw new Error("Isi password dan PIN sekaligus untuk menggantinya")
      }

      await updateAppSettings({
        ...toUpdateAppSettingsInput(currentSettings),
        ppob: {
          enabled,
          phone_number: phoneNumber,
          device_id: deviceId,
          markup,
        },
      })

      if (wantsCredentialChange) {
        await updatePpobCredentials({ password, pin })
      }
    },
    {
      onSuccess: () => {
        setPassword("")
        setPin("")
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

  const isReady = settingsQuery.isSuccess && initialized

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

  return (
    <div className="flex flex-col gap-6">
      {/* Card 1: Koneksi */}
      <Card>
        <Card.Header>
          <Card.Title>{id.ppob.settingsTitle}</Card.Title>
          <Card.Description>
            Konfigurasi koneksi ke Mitra Indogrosir untuk layanan PPOB
          </Card.Description>
        </Card.Header>
        <Card.Content className="gap-6">
          <Switch className="w-full" isSelected={enabled} onChange={setEnabled}>
            <Switch.Content className="w-full justify-between">
              {id.ppob.enabled}
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
            <Description>{id.ppob.enabledDesc}</Description>
          </Switch>

          <Separator />

          <div className="flex flex-col gap-4">
            <TextField
              fullWidth
              isDisabled={!enabled}
              type="tel"
              value={phoneNumber}
              variant="secondary"
              onChange={setPhoneNumber}
            >
              <Label>{id.ppob.mitraPhone}</Label>
              <Input placeholder={id.ppob.mitraPhonePlaceholder} />
            </TextField>

            <TextField
              fullWidth
              isDisabled={!enabled}
              type="password"
              value={password}
              variant="secondary"
              onChange={setPassword}
            >
              <Label>{id.ppob.mitraPassword}</Label>
              <Input
                placeholder={
                  hasStoredCredentials
                    ? "Tersimpan — isi hanya jika ingin mengganti"
                    : id.ppob.mitraPasswordPlaceholder
                }
              />
            </TextField>

            <div className="flex flex-col gap-1">
              <div className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  isDisabled={!enabled}
                  value={deviceId}
                  variant="secondary"
                  onChange={setDeviceId}
                >
                  <Label>{id.ppob.mitraDeviceId}</Label>
                  <Input placeholder={id.ppob.mitraDeviceIdPlaceholder} />
                </TextField>
                <Button
                  aria-label="Generate Device ID"
                  isDisabled={!enabled}
                  isIconOnly
                  type="button"
                  variant="tertiary"
                  onPress={() => setDeviceId(crypto.randomUUID())}
                >
                  <RefreshCw />
                </Button>
              </div>
              <Description>
                Masukkan device ID dari HP atau klik tombol generate untuk membuat ID baru
              </Description>
            </div>

            <TextField
              fullWidth
              isDisabled={!enabled}
              type="password"
              value={pin}
              variant="secondary"
              onChange={setPin}
            >
              <Label>{id.ppob.mitraPin}</Label>
              <Input
                placeholder={
                  hasStoredCredentials
                    ? "Tersimpan — isi hanya jika ingin mengganti"
                    : id.ppob.mitraPinPlaceholder
                }
              />
            </TextField>

            <p className="text-sm text-muted">
              {hasStoredCredentials
                ? "Password dan PIN sudah tersimpan dan tidak pernah dikirim kembali ke layar ini. Kosongkan keduanya untuk mempertahankannya, atau isi keduanya sekaligus untuk mengganti."
                : "Password dan PIN belum tersimpan. Isi keduanya untuk mengaktifkan layanan PPOB."}
            </p>
          </div>
        </Card.Content>
        {/* Dua tombol Simpan (di sini dan di kartu Markup) memanggil mutasi yang
            sama; test menghitung keduanya. Menyatukannya adalah keputusan pemilik. */}
        <Card.Footer className="gap-2">
          <PendingButton
            isDisabled={!isReady}
            isPending={saveMutation.isPending}
            onPress={() => saveMutation.mutate(undefined)}
          >
            <Save />
            {id.common.save}
          </PendingButton>
          <PendingButton
            isDisabled={!enabled || !phoneNumber}
            isPending={testMutation.isPending}
            variant="secondary"
            onPress={() => testMutation.mutate(undefined)}
          >
            {id.ppob.testConnection}
          </PendingButton>
        </Card.Footer>
      </Card>

      {/* Card 2: Markup & Harga Jual */}
      <Card>
        <Card.Header>
          <Card.Title>Markup & Harga Jual</Card.Title>
          <Card.Description>
            Atur margin keuntungan untuk setiap jenis layanan PPOB
          </Card.Description>
        </Card.Header>
        <Card.Content className="gap-6">
          {/* Dua kelompok isian dalam satu kartu: `Fieldset` memberi legenda dan
              keterangannya bentuk yang sama tanpa judul kartu kedua. */}
          <Fieldset>
            <Fieldset.Legend>Markup per Layanan</Fieldset.Legend>
            <Description>Harga jual = harga modal + markup</Description>
            <Fieldset.Group>
              {MARKUP_SERVICES.map(({ key, label }) => {
                const config = markup[key]
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-sm font-medium">{label}</span>
                    <Select
                      aria-label={`Tipe markup ${label}`}
                      className="w-32"
                      isDisabled={!enabled}
                      value={config.type}
                      variant="secondary"
                      onChange={(value) => {
                        if (value === null) return
                        const type = value === "percentage" ? "percentage" : "fixed"
                        setMarkup((prev) => ({ ...prev, [key]: { ...prev[key], type } }))
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value>{selectedText}</Select.Value>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {MARKUP_TYPES.map((option) => (
                            <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                              <Label>{option.label}</Label>
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {/* Grouping stays off for the same reason as the custom prices
                        below: without an I18nProvider the parse locale follows the
                        webview, and a grouped value would not survive a re-read. */}
                    <NumberField
                      aria-label={`Nilai markup ${label}`}
                      className="w-28"
                      formatOptions={{ useGrouping: false, maximumFractionDigits: 2 }}
                      isDisabled={!enabled}
                      minValue={0}
                      value={config.value > 0 ? config.value : Number.NaN}
                      variant="secondary"
                      onChange={(value) => {
                        const next = value === undefined || Number.isNaN(value) ? 0 : value
                        setMarkup((prev) => ({ ...prev, [key]: { ...prev[key], value: next } }))
                      }}
                    >
                      <NumberField.Group>
                        <NumberField.Input
                          className="text-right tabular-nums"
                          placeholder={config.type === "fixed" ? "cth: 2000" : "cth: 5"}
                        />
                      </NumberField.Group>
                    </NumberField>
                    <span className="text-sm text-muted">
                      {config.type === "fixed" ? "Rp" : "%"}
                    </span>
                  </div>
                )
              })}
            </Fieldset.Group>
          </Fieldset>

          <Separator />

          <PpobCustomPrices
            customPrices={markup.custom_prices}
            onCustomPricesChange={(prices) =>
              setMarkup((prev) => ({ ...prev, custom_prices: prices }))
            }
            disabled={!enabled}
          />
        </Card.Content>
        <Card.Footer>
          <PendingButton
            isDisabled={!isReady}
            isPending={saveMutation.isPending}
            onPress={() => saveMutation.mutate(undefined)}
          >
            <Save />
            {id.common.save}
          </PendingButton>
        </Card.Footer>
      </Card>
    </div>
  )
}
