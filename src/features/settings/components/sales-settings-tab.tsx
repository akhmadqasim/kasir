import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { Card, Description, Label, ListBox, Select, Separator, Switch } from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { selectedText } from "@/components/selected-text"
import { id } from "@/i18n/id"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { getAppSettings, toUpdateAppSettingsInput, updateAppSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { AppSettings } from "../types"

export function SalesSettingsTab() {
  const queryClient = useQueryClient()

  const [allowNegativeStock, setAllowNegativeStock] = useState(false)
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState("cash")
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  if (settingsQuery.data && !initialized) {
    const { sales } = settingsQuery.data
    setAllowNegativeStock(sales.allow_negative_stock)
    setDefaultPaymentMethod(sales.default_payment_method)
    setInitialized(true)
  }

  const saveMutation = useApiMutation<void, void>(
    () => {
      // The server rewrites all four blocks at once, so this tab has to send the
      // other three back untouched. Saving before the query resolves would post
      // hardcoded defaults over them.
      const current = settingsQuery.data
      if (!current) {
        return Promise.reject(new Error("Pengaturan belum dimuat, coba lagi sebentar"))
      }
      return updateAppSettings({
        ...toUpdateAppSettingsInput(current),
        sales: {
          allow_negative_stock: allowNegativeStock,
          default_payment_method: defaultPaymentMethod,
        },
      })
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.app })
        toast.success(id.settings.salesSettingsSaved)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    },
  )

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
      <Card.Content className="gap-6">
        {/* The label now sits inside the Switch, so clicking the text toggles it and
            the description is wired up through aria-describedby — neither held with
            the old free-standing Label. */}
        <Switch className="w-full" isSelected={allowNegativeStock} onChange={setAllowNegativeStock}>
          <Switch.Content className="w-full justify-between">
            {id.settings.allowNegativeStock}
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
          <Description>{id.settings.allowNegativeStockDesc}</Description>
        </Switch>

        <Separator />

        <Select
          fullWidth
          value={defaultPaymentMethod || null}
          variant="secondary"
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
      </Card.Content>
      <Card.Footer>
        <PendingButton
          isDisabled={!isReady}
          isPending={saveMutation.isPending}
          onPress={() => saveMutation.mutate(undefined)}
        >
          <Save />
          Simpan
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}
