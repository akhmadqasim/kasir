import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save, Loader2, RefreshCw } from "lucide-react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
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
        <CardHeader>
          <CardTitle>{id.ppob.settingsTitle}</CardTitle>
          <CardDescription>
            Konfigurasi koneksi ke Mitra Indogrosir untuk layanan PPOB
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{id.ppob.enabled}</Label>
              <p className="text-xs text-muted-foreground">
                {id.ppob.enabledDesc}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{id.ppob.mitraPhone}</Label>
              <Input
                type="tel"
                placeholder={id.ppob.mitraPhonePlaceholder}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <Label>{id.ppob.mitraPassword}</Label>
              <Input
                type="password"
                placeholder={id.ppob.mitraPasswordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!enabled}
              />
            </div>

            <div className="space-y-2">
              <Label>{id.ppob.mitraDeviceId}</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder={id.ppob.mitraDeviceIdPlaceholder}
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  disabled={!enabled}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!enabled}
                  onClick={() => setDeviceId(crypto.randomUUID())}
                  title="Generate Device ID"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Masukkan device ID dari HP atau klik tombol generate untuk membuat ID baru
              </p>
            </div>

            <div className="space-y-2">
              <Label>{id.ppob.mitraPin}</Label>
              <Input
                type="password"
                placeholder={id.ppob.mitraPinPlaceholder}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                disabled={!enabled}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !isReady}
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Menyimpan..." : id.common.save}
            </Button>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !enabled || !phoneNumber}
            >
              {testMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {id.ppob.testConnection}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Markup & Harga Jual */}
      <Card>
        <CardHeader>
          <CardTitle>Markup & Harga Jual</CardTitle>
          <CardDescription>
            Atur margin keuntungan untuk setiap jenis layanan PPOB
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-0.5">
              <Label className="text-base">Markup per Layanan</Label>
              <p className="text-xs text-muted-foreground">
                Harga jual = harga modal + markup
              </p>
            </div>

            <div className="grid gap-3">
              {MARKUP_SERVICES.map(({ key, label }) => {
                const config = markup[key]
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-20 text-sm font-medium">{label}</span>
                    <Select
                      value={config.type}
                      onValueChange={(val: "fixed" | "percentage") => {
                        setMarkup((prev) => ({
                          ...prev,
                          [key]: { ...prev[key], type: val },
                        }))
                      }}
                      disabled={!enabled}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                        <SelectItem value="percentage">Persentase (%)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      placeholder={config.type === "fixed" ? "cth: 2000" : "cth: 5"}
                      value={config.value > 0 ? config.value : ""}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0
                        setMarkup((prev) => ({
                          ...prev,
                          [key]: { ...prev[key], value: val },
                        }))
                      }}
                      disabled={!enabled}
                      className="w-28 tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">
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
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !isReady}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Menyimpan..." : id.common.save}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
