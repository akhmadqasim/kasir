import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save, Loader2 } from "lucide-react"
import { toast } from "sonner"
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
import { Separator } from "@/components/ui/separator"
import { id } from "@/i18n/id"
import type { AppSettingsWithPpob } from "@/features/ppob/types"

export function PpobSettingsTab() {
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState("")
  const [password, setPassword] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [pin, setPin] = useState("")
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useQuery<AppSettingsWithPpob>({
    queryKey: ["app-settings"],
    queryFn: () => invoke<AppSettingsWithPpob>("get_app_settings"),
  })

  if (settingsQuery.data && !initialized) {
    const { ppob } = settingsQuery.data
    if (ppob) {
      setEnabled(ppob.enabled)
      setPhoneNumber(ppob.phone_number)
      setPassword(ppob.password)
      setDeviceId(ppob.device_id)
      setPin(ppob.pin)
    }
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const currentSettings = settingsQuery.data
      return invoke("update_app_settings", {
        settings: {
          sales: currentSettings?.sales ?? {
            allow_negative_stock: true,
            default_payment_method: "cash",
          },
          security: currentSettings?.security ?? {
            session_timeout_minutes: 30,
          },
          ppob: {
            enabled,
            phone_number: phoneNumber,
            password,
            device_id: deviceId,
            pin,
          },
        },
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
            <Input
              type="text"
              placeholder={id.ppob.mitraDeviceIdPlaceholder}
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={!enabled}
              className="font-mono"
            />
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

        <Separator />

        <div className="flex gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
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
  )
}
