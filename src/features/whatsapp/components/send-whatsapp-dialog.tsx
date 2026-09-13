import { useState } from "react"
import { Button, Input, Label, Modal, TextField } from "@heroui/react"

import { PendingButton } from "@/components/pending-button"
import { id as t } from "@/i18n/id"
import { useApiMutation } from "@/hooks/use-api"
import { errorMessage } from "@/lib/api/client"
import { sendWhatsappReceipt } from "@/lib/api/whatsapp"
import { toast } from "@/lib/toast"
import { getLastPhone, setLastPhone } from "../last-phone"

interface SendWhatsappDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  transactionId: number
}

/**
 * A small dialog over the transaction success screen and the history detail:
 * type (or reuse) a number, send the struk as a WhatsApp image. Only ever
 * rendered while WhatsApp is connected — the caller checks that.
 */
export function SendWhatsappDialog({
  isOpen,
  onOpenChange,
  transactionId,
}: SendWhatsappDialogProps) {
  const [phone, setPhone] = useState(() => getLastPhone())

  const sendMutation = useApiMutation(sendWhatsappReceipt, {
    onSuccess: () => {
      setLastPhone(phone.trim())
      toast.success(t.whatsapp.sendSuccess)
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(`${t.whatsapp.sendFailed}: ${errorMessage(error)}`)
    },
  })

  const handleSend = () => {
    const trimmed = phone.trim()
    if (!trimmed) {
      toast.error(t.whatsapp.phoneNumberRequired)
      return
    }
    sendMutation.mutate({ transaction_id: transactionId, phone: trimmed })
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={t.whatsapp.sendDialogTitle}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t.whatsapp.sendDialogTitle}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <TextField
              autoFocus
              fullWidth
              inputMode="numeric"
              value={phone}
              variant="secondary"
              onChange={setPhone}
            >
              <Label>{t.whatsapp.phoneNumber}</Label>
              <Input placeholder={t.whatsapp.phoneNumberPlaceholder} />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <Button
              isDisabled={sendMutation.isPending}
              variant="tertiary"
              onPress={() => onOpenChange(false)}
            >
              {t.common.cancel}
            </Button>
            <PendingButton isPending={sendMutation.isPending} onPress={handleSend}>
              {t.whatsapp.send}
            </PendingButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
