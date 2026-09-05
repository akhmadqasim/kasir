import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save, RefreshCw } from "lucide-react"
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Separator,
  Spinner,
  Switch,
  TextField,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { selectedText } from "@/components/selected-text"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
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
  const user = useAuthStore((s) => s.user)
  const [enabled, setEnabled] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState("")
  const [password, setPassword] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [pin, setPin] = useState("")
  const [markup, setMarkup] = useState<PpobMarkup>(DEFAULT_MARKUP)
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useQuery<AppSettings>({
    queryKey: ["app-settings"],
    queryFn: () => invoke<AppSettings>("get_app_settings"),
  })

  if (settingsQuery.data && !initialized) {
    const { ppob } = settingsQuery.data
    if (ppob) {
      setEnabled(ppob.enabled)
      setPhoneNumber(ppob.phone_number)
      setPassword(ppob.password)
      setDeviceId(ppob.device_id)
      setPin(ppob.pin)
      if (ppob.markup) {
        setMarkup({ ...DEFAULT_MARKUP, ...ppob.markup })
      }
    }
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      // The backend rewrites all four blocks at once, so posting hardcoded defaults
      // for the blocks this tab does not own would silently reset them.
      const currentSettings = settingsQuery.data
      if (!currentSettings) {
        throw new Error("Pengaturan belum dimuat, coba lagi sebentar")
      }
      return invoke("update_app_settings", {
        settings: {
          sales: currentSettings.sales,
          security: currentSettings.security,
          backup: currentSettings.backup,
          ppob: {
            enabled,
            phone_number: phoneNumber,
            password,
            device_id: deviceId,
            pin,
            markup,
          },
        },
        callerId: user!.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] })
      queryClient.invalidateQueries({ queryKey: ["ppob_get_saldo"] })
      toast.success(id.ppob.settingsSaved)
    },
    onError: (error) => {
      toast.error(String(error))
    },
  })

  const isReady = settingsQuery.isSuccess && initialized

  const testMutation = useMutation({
    mutationFn: () => invoke("ppob_login"),
    onSuccess: (data: unknown) => {
      const result = data as { saldo: number; username: string }
      toast.success(`${id.ppob.testConnectionSuccess}: ${result.username} (Saldo: Rp ${result.saldo.toLocaleString("id-ID")})`)
    },
    onError: (error) => {
      toast.error(`${id.ppob.testConnectionFailed}: ${String(error)}`)
    },
  })

  return (
    <div className="space-y-6">
      {/* Card 1: Koneksi */}
      <Card>
        <Card.Header>
          <Card.Title>{id.ppob.settingsTitle}</Card.Title>
          <Card.Description>
            Konfigurasi koneksi ke Mitra Indogrosir untuk layanan PPOB
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-6">
          <Switch className="w-full" isSelected={enabled} onChange={setEnabled}>
            <Switch.Content className="w-full justify-between">
              <span className="text-sm font-medium">{id.ppob.enabled}</span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
            <Description className="text-xs">{id.ppob.enabledDesc}</Description>
          </Switch>

          <Separator />

          <div className="space-y-4">
            <TextField
              fullWidth
              isDisabled={!enabled}
              type="tel"
              value={phoneNumber}
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
              onChange={setPassword}
            >
              <Label>{id.ppob.mitraPassword}</Label>
              <Input placeholder={id.ppob.mitraPasswordPlaceholder} />
            </TextField>

            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  isDisabled={!enabled}
                  value={deviceId}
                  onChange={setDeviceId}
                >
                  <Label>{id.ppob.mitraDeviceId}</Label>
                  <Input
                    className="font-mono"
                    placeholder={id.ppob.mitraDeviceIdPlaceholder}
                  />
                </TextField>
                <Button
                  aria-label="Generate Device ID"
                  isDisabled={!enabled}
                  isIconOnly
                  type="button"
                  variant="outline"
                  onPress={() => setDeviceId(crypto.randomUUID())}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted">
                Masukkan device ID dari HP atau klik tombol generate untuk membuat ID baru
              </p>
            </div>

            <TextField
              fullWidth
              isDisabled={!enabled}
              type="password"
              value={pin}
              onChange={setPin}
            >
              <Label>{id.ppob.mitraPin}</Label>
              <Input placeholder={id.ppob.mitraPinPlaceholder} />
            </TextField>
          </div>

          <div className="flex gap-2">
            <Button
              isDisabled={saveMutation.isPending || !isReady}
              onPress={() => saveMutation.mutate()}
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Menyimpan..." : id.common.save}
            </Button>
            {/* HeroUI's `isPending` only exposes the flag — the spinner is ours to
                render — but it is what puts the button in the aria "busy" state. */}
            <Button
              isDisabled={testMutation.isPending || !enabled || !phoneNumber}
              isPending={testMutation.isPending}
              variant="outline"
              onPress={() => testMutation.mutate()}
            >
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner className="mr-2" color="current" size="sm" /> : null}
                  {id.ppob.testConnection}
                </>
              )}
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* Card 2: Markup & Harga Jual */}
      <Card>
        <Card.Header>
          <Card.Title>Markup & Harga Jual</Card.Title>
          <Card.Description>
            Atur margin keuntungan untuk setiap jenis layanan PPOB
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-0.5">
              <p className="text-base font-medium">Markup per Layanan</p>
              <p className="text-xs text-muted">Harga jual = harga modal + markup</p>
            </div>

            <div className="grid gap-3">
              {MARKUP_SERVICES.map(({ key, label }) => {
                const config = markup[key]
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-20 text-sm font-medium">{label}</span>
                    <Select
                      aria-label={`Tipe markup ${label}`}
                      className="w-32"
                      isDisabled={!enabled}
                      value={config.type}
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
                            <ListBox.Item
                              key={option.key}
                              id={option.key}
                              textValue={option.label}
                            >
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
                      onChange={(value) => {
                        const next = value === undefined || Number.isNaN(value) ? 0 : value
                        setMarkup((prev) => ({ ...prev, [key]: { ...prev[key], value: next } }))
                      }}
                    >
                      <NumberField.Group>
                        <NumberField.Input
                          className="tabular-nums"
                          placeholder={config.type === "fixed" ? "cth: 2000" : "cth: 5"}
                        />
                      </NumberField.Group>
                    </NumberField>
                    <span className="text-xs text-muted">
                      {config.type === "fixed" ? "Rp" : "%"}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <Separator />

          <PpobCustomPrices
            customPrices={markup.custom_prices}
            onCustomPricesChange={(prices) => setMarkup((prev) => ({ ...prev, custom_prices: prices }))}
            disabled={!enabled}
          />

          <Button
            isDisabled={saveMutation.isPending || !isReady}
            onPress={() => saveMutation.mutate()}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Menyimpan..." : id.common.save}
          </Button>
        </Card.Content>
      </Card>
    </div>
  )
}
