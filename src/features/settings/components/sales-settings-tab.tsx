import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { Card, Description, Switch } from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { toast } from "@/lib/toast"
import { LoadError } from "@/components/load-error"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { useApiQuery } from "@/hooks/use-api"
import { getAppSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { SELECTABLE_PAYMENT_METHODS, paymentMethodLabel } from "@/lib/labels"
import { useSaveAppSettingsSection } from "../hooks/use-save-app-settings-section"
import type { AppSettings } from "../types"

const PAYMENT_OPTIONS = SELECTABLE_PAYMENT_METHODS.map((key) => ({
  key,
  label: paymentMethodLabel(key),
}))

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

  const saveMutation = useSaveAppSettingsSection("sales", {
    onSaved: () => {
      // The till reads the default payment method from its own slice.
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.sales })
      toast.success(id.settings.salesSettingsSaved)
    },
  })

  const isReady = settingsQuery.isSuccess && initialized

  if (settingsQuery.isError) {
    return (
      <Card>
        <LoadError
          isRetrying={settingsQuery.isFetching}
          title={id.loadFailed.salesSettings}
          onRetry={() => void settingsQuery.refetch()}
        >
          {settingsQuery.error.message}
        </LoadError>
      </Card>
    )
  }

  return (
    <Card>
      <Card.Header>
        <CardHeading>{id.settings.tabSales}</CardHeading>
        <Card.Description>Aturan yang dipakai layar kasir di setiap transaksi.</Card.Description>
      </Card.Header>
      <Card.Content className="gap-6">
        {/* Susunan "With Description" dari dokumentasi Switch: kontrol di kiri,
            label di kanannya, keterangan di bawah. Mengklik teksnya ikut
            menggeser, dan keterangannya tersambung lewat aria-describedby. */}
        {/* Locked until the stored values land: a toggle flipped before then
            would be silently overwritten by them. */}
        <Switch
          isDisabled={!isReady}
          isSelected={allowNegativeStock}
          onChange={setAllowNegativeStock}
        >
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
          isDisabled={!isReady}
          label={id.settings.defaultPaymentMethod}
          options={PAYMENT_OPTIONS}
          value={defaultPaymentMethod || null}
          variant="secondary"
          onChange={(value) => setDefaultPaymentMethod(value ?? "")}
        />
      </Card.Content>
      <Card.Footer>
        <PendingButton
          isDisabled={!isReady}
          isPending={saveMutation.isPending}
          onPress={() =>
            saveMutation.mutate({
              allow_negative_stock: allowNegativeStock,
              default_payment_method: defaultPaymentMethod,
            })
          }
        >
          <Save />
          {id.common.save}
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}
