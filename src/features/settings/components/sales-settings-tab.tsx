import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { Card, Description, Label, NumberField, Switch } from "@heroui/react"

import { toast } from "@/lib/toast"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { getAppSettings, toUpdateAppSettingsInput, updateAppSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { isEmptyNumberFieldValue } from "@/lib/number-field"
import type { AppSettings } from "../types"

/** Same bounds as the server's clamp: one minute to thirty days. */
const TIMEOUT_MIN = 1
const TIMEOUT_MAX = 60 * 24 * 30

export function SalesSettingsTab() {
  const queryClient = useQueryClient()

  const [allowNegativeStock, setAllowNegativeStock] = useState(false)
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState("cash")
  const [sessionTimeout, setSessionTimeout] = useState(12 * 60)
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  if (settingsQuery.data && !initialized) {
    const { sales, security } = settingsQuery.data
    setAllowNegativeStock(sales.allow_negative_stock)
    setDefaultPaymentMethod(sales.default_payment_method)
    setSessionTimeout(security.session_timeout_minutes)
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
        security: { session_timeout_minutes: sessionTimeout },
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
    { key: "cash", label: id.payment.cash },
    { key: "qris", label: id.payment.qris },
    { key: "debit", label: id.payment.debit },
    { key: "ewallet", label: id.payment.ewallet },
    { key: "transfer", label: id.payment.transfer },
  ]

  return (
    <Card>
      <Card.Header>
        <Card.Title>{id.settings.tabSales}</Card.Title>
      </Card.Header>
      <Card.Content className="gap-6">
        {/* Susunan "With Description" dari dokumentasi Switch: kontrol di kiri,
            label di kanannya, keterangan di bawah. Mengklik teksnya ikut
            menggeser, dan keterangannya tersambung lewat aria-describedby. */}
        <Switch isSelected={allowNegativeStock} onChange={setAllowNegativeStock}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            {id.settings.allowNegativeStock}
          </Switch.Content>
          <Description>{id.settings.allowNegativeStockDesc}</Description>
        </Switch>

        <OptionSelect
          fullWidth
          label={id.settings.defaultPaymentMethod}
          options={paymentOptions}
          value={defaultPaymentMethod || null}
          variant="secondary"
          onChange={(value) => setDefaultPaymentMethod(value ?? "")}
        />

        {/* The idle limit lives here rather than on a tab of its own: it is the
            one security knob, and it decides how often the cashier logs in. */}
        <NumberField
          fullWidth
          maxValue={TIMEOUT_MAX}
          minValue={TIMEOUT_MIN}
          value={sessionTimeout}
          variant="secondary"
          onChange={(value) => {
            if (!isEmptyNumberFieldValue(value)) setSessionTimeout(value)
          }}
        >
          <Label>{id.settings.sessionTimeout}</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="tabular-nums" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <Description>{id.settings.sessionTimeoutDesc}</Description>
        </NumberField>
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
