import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { LogOut, Save } from "lucide-react"
import {
  AlertDialog,
  Button,
  Card,
  Description,
  Label,
  Spinner,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react"

import { PendingButton } from "@/components/pending-button"
import { StatusBadge, type StatusVariant } from "@/components/status-badge"
import { useWhatsappActions, useWhatsappStatus } from "@/features/whatsapp"
import type { WhatsappState } from "@/features/whatsapp"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { id as t } from "@/i18n/id"
import { queryKeys } from "@/lib/api/query-keys"
import { getWhatsappSettings, updateWhatsappSettings } from "@/lib/api/whatsapp"
import { toast } from "@/lib/toast"

const STATUS_LABEL: Record<WhatsappState, string> = {
  off: t.whatsapp.statusOff,
  starting: t.whatsapp.statusStarting,
  qr_pending: t.whatsapp.statusQrPending,
  ready: t.whatsapp.statusReady,
  disconnected: t.whatsapp.statusDisconnected,
}

const STATUS_VARIANT: Record<WhatsappState, StatusVariant> = {
  off: "neutral",
  starting: "info",
  qr_pending: "info",
  ready: "success",
  disconnected: "error",
}

/**
 * Pengaturan → WhatsApp: enable/disable, the QR to link a phone, the
 * connected number, and the caption template sent with every struk. The
 * connection itself (`useWhatsappStatus`) is shared with the "Kirim WhatsApp"
 * buttons elsewhere, so a link made here shows up there without a refresh.
 */
export function WhatsappTab() {
  const queryClient = useQueryClient()
  const { data: status } = useWhatsappStatus()
  const { enable, disable, logout } = useWhatsappActions()

  const [captionTemplate, setCaptionTemplate] = useState("")
  const [initialized, setInitialized] = useState(false)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

  const settingsQuery = useApiQuery(queryKeys.whatsapp.settings, getWhatsappSettings)

  if (settingsQuery.data && !initialized) {
    setCaptionTemplate(settingsQuery.data.caption_template)
    setInitialized(true)
  }

  const saveMutation = useApiMutation(updateWhatsappSettings, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.settings })
      toast.success(t.whatsapp.settingsSaved)
    },
    onError: (error) => toast.error(error.message),
  })

  const handleToggle = (checked: boolean) => {
    if (checked) {
      enable.mutate(undefined, { onSuccess: () => toast.success(t.whatsapp.enabledSuccess) })
    } else {
      disable.mutate(undefined, { onSuccess: () => toast.success(t.whatsapp.disabledSuccess) })
    }
  }

  const handleDisconnect = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        toast.success(t.whatsapp.disconnectedSuccess)
        setShowDisconnectConfirm(false)
      },
    })
  }

  const state = status?.state ?? "off"
  const isToggleBusy = enable.isPending || disable.isPending

  return (
    <>
      <Card>
        <Card.Header className="flex-row items-center justify-between gap-2">
          <Card.Title>{t.whatsapp.title}</Card.Title>
          <StatusBadge status={STATUS_VARIANT[state]}>
            {(state === "starting" || state === "qr_pending") && (
              <Spinner className="size-3" color="current" size="sm" />
            )}
            {STATUS_LABEL[state]}
          </StatusBadge>
        </Card.Header>
        <Card.Content className="gap-6">
          <Switch
            isDisabled={isToggleBusy}
            isSelected={status?.enabled ?? false}
            onChange={handleToggle}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t.whatsapp.enable}
            </Switch.Content>
            <Description>{t.whatsapp.enableDesc}</Description>
          </Switch>

          {state === "qr_pending" && status?.qr && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-default-200 p-4">
              <QRCodeSVG level="M" size={200} value={status.qr} />
              <p className="text-center text-sm text-muted">{t.whatsapp.scanInstruction}</p>
            </div>
          )}

          {state === "ready" && (
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted">{t.whatsapp.connectedNumber}</p>
                <p className="font-medium text-foreground">{status?.number}</p>
              </div>
              <Button variant="secondary" onPress={() => setShowDisconnectConfirm(true)}>
                <LogOut />
                {t.whatsapp.disconnect}
              </Button>
            </div>
          )}

          {state === "disconnected" && status?.reason && (
            <p className="text-sm text-danger">{status.reason}</p>
          )}

          <TextField
            fullWidth
            value={captionTemplate}
            variant="secondary"
            onChange={setCaptionTemplate}
          >
            <Label>{t.whatsapp.captionTemplate}</Label>
            <TextArea placeholder={t.whatsapp.captionTemplatePlaceholder} rows={3} />
            <Description>{t.whatsapp.captionTemplateDesc}</Description>
          </TextField>
        </Card.Content>
        <Card.Footer>
          <PendingButton
            isDisabled={!initialized}
            isPending={saveMutation.isPending}
            onPress={() => saveMutation.mutate({ caption_template: captionTemplate })}
          >
            <Save />
            {t.common.save}
          </PendingButton>
        </Card.Footer>
      </Card>

      <AlertDialog.Backdrop isOpen={showDisconnectConfirm} onOpenChange={setShowDisconnectConfirm}>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={t.whatsapp.disconnectConfirmTitle}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{t.whatsapp.disconnectConfirmTitle}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{t.whatsapp.disconnectConfirmBody}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={logout.isPending} slot="close" variant="tertiary">
                {t.common.cancel}
              </Button>
              <PendingButton
                isPending={logout.isPending}
                variant="danger"
                onPress={handleDisconnect}
              >
                {t.whatsapp.disconnectConfirm}
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
