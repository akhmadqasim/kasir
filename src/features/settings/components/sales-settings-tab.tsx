import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { AppSettings } from "../types"

export function SalesSettingsTab() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const [allowNegativeStock, setAllowNegativeStock] = useState(false)
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState("cash")
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useQuery<AppSettings>({
    queryKey: ["app-settings"],
    queryFn: () => invoke<AppSettings>("get_app_settings"),
  })

  if (settingsQuery.data && !initialized) {
    const { sales } = settingsQuery.data
    setAllowNegativeStock(sales.allow_negative_stock)
    setDefaultPaymentMethod(sales.default_payment_method)
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const currentSecurity = settingsQuery.data?.security ?? {
        session_timeout_minutes: 30,
      }
      const currentPpob = settingsQuery.data?.ppob ?? {
        enabled: false,
        phone_number: "",
        password: "",
        device_id: "",
        pin: "",
        markup: {
          pulsa: { type: "fixed", value: 0 },
          data: { type: "fixed", value: 0 },
          pln: { type: "fixed", value: 0 },
          pdam: { type: "fixed", value: 0 },
          bpjs: { type: "fixed", value: 0 },
          emoney: { type: "fixed", value: 0 },
          custom_prices: {},
        },
      }
      const currentBackup = settingsQuery.data?.backup ?? {
        interval_hours: 3,
        retention_days: 90,
      }
      return invoke("update_app_settings", {
        settings: {
          sales: {
            allow_negative_stock: allowNegativeStock,
            default_payment_method: defaultPaymentMethod,
          },
          security: currentSecurity,
          ppob: currentPpob,
          backup: currentBackup,
        },
        callerId: user!.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] })
      toast.success(id.settings.salesSettingsSaved)
    },
    onError: (error) => {
      toast.error(String(error))
    },
  })

  const paymentOptions = [
    { value: "cash", label: id.payment.cash },
    { value: "qris", label: id.payment.qris },
    { value: "ewallet", label: id.payment.ewallet },
    { value: "transfer", label: id.payment.transfer },
  ] as const

  return (
    <Card>
      <CardHeader>
        <CardTitle>{id.settings.tabSales}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{id.settings.allowNegativeStock}</Label>
            <p className="text-xs text-muted-foreground">
              {id.settings.allowNegativeStockDesc}
            </p>
          </div>
          <Switch
            checked={allowNegativeStock}
            onCheckedChange={setAllowNegativeStock}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>{id.settings.defaultPaymentMethod}</Label>
          <Select
            value={defaultPaymentMethod}
            onValueChange={setDefaultPaymentMethod}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {paymentOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <Save className="mr-2 h-4 w-4" />
          {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
      </CardContent>
    </Card>
  )
}
