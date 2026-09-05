import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import {
  Button,
  Card,
  Description,
  Label,
  ListBox,
  Select,
  Separator,
  Switch,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { selectedText } from "@/components/selected-text"
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
      // The backend rewrites all four blocks at once. Saving before the query
      // resolves would post hardcoded defaults and wipe the PPOB credentials.
      const current = settingsQuery.data
      if (!current) {
        throw new Error("Pengaturan belum dimuat, coba lagi sebentar")
      }
      return invoke("update_app_settings", {
        settings: {
          sales: {
            allow_negative_stock: allowNegativeStock,
            default_payment_method: defaultPaymentMethod,
          },
          security: current.security,
          ppob: current.ppob,
          backup: current.backup,
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

  const isReady = settingsQuery.isSuccess && initialized

  const paymentOptions = [
    { value: "cash", label: id.payment.cash },
    { value: "qris", label: id.payment.qris },
    { value: "debit", label: id.payment.debit },
    { value: "ewallet", label: id.payment.ewallet },
    { value: "transfer", label: id.payment.transfer },
  ] as const

  return (
    <Card>
      <Card.Header>
        <Card.Title>{id.settings.tabSales}</Card.Title>
      </Card.Header>
      <Card.Content className="space-y-6">
        {/* The label now sits inside the Switch, so clicking the text toggles it and
            the description is wired up through aria-describedby — neither held with
            the old free-standing Label. */}
        <Switch
          className="w-full"
          isSelected={allowNegativeStock}
          onChange={setAllowNegativeStock}
        >
          <Switch.Content className="w-full justify-between">
            <span className="text-sm font-medium">{id.settings.allowNegativeStock}</span>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
          <Description className="text-xs">
            {id.settings.allowNegativeStockDesc}
          </Description>
        </Switch>

        <Separator />

        <Select
          fullWidth
          value={defaultPaymentMethod || null}
          onChange={(value) => setDefaultPaymentMethod(value === null ? "" : String(value))}
        >
          <Label>{id.settings.defaultPaymentMethod}</Label>
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {paymentOptions.map((option) => (
                <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                  <Label>{option.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Separator />

        <Button
          isDisabled={saveMutation.isPending || !isReady}
          onPress={() => saveMutation.mutate()}
        >
          <Save className="mr-2 h-4 w-4" />
          {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
      </Card.Content>
    </Card>
  )
}
