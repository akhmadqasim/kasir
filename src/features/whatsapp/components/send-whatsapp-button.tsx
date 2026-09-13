import { useState } from "react"
import { Button, type ButtonProps } from "@heroui/react"
import { MessageCircle } from "lucide-react"

import { id as t } from "@/i18n/id"
import { useWhatsappStatus } from "../hooks/use-whatsapp-status"
import { SendWhatsappDialog } from "./send-whatsapp-dialog"

interface SendWhatsappButtonProps {
  transactionId: number
  variant?: ButtonProps["variant"]
}

/**
 * "Kirim WhatsApp" for the transaction success dialog and the history detail.
 *
 * Renders nothing unless the connection is `ready` — the send route needs
 * one, so offering the button otherwise would only teach the cashier a way to
 * fail. Both callers share this rather than each polling the status and
 * managing the dialog's own open state.
 */
export function SendWhatsappButton({ transactionId, variant = "secondary" }: SendWhatsappButtonProps) {
  const { data: status } = useWhatsappStatus()
  const [open, setOpen] = useState(false)

  if (status?.state !== "ready") return null

  return (
    <>
      <Button variant={variant} onPress={() => setOpen(true)}>
        <MessageCircle />
        {t.whatsapp.sendReceipt}
      </Button>
      <SendWhatsappDialog isOpen={open} onOpenChange={setOpen} transactionId={transactionId} />
    </>
  )
}
