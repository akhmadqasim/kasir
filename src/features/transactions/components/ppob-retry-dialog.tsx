import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertDialog, Button, Input, Label, TextField } from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import { ppobRetryFailureMessage, ppobRetrySuccessMessage, retryPpobLines } from "../ppob-retry"
import type { TransactionItem } from "../types"

const TITLE = id.ppobFulfillment.retryTitle

interface PpobRetryDialogProps {
  /** The failed PPOB lines to send back to the provider. */
  items: TransactionItem[]
  isOpen: boolean
  onClose: () => void
}

/**
 * Asks for the Mitra PIN and retries every failed PPOB line with it. The PIN
 * travels once, with these requests only, and is cleared as soon as the dialog
 * closes — it is never kept anywhere between attempts.
 */
export function PpobRetryDialog({ items, isOpen, onClose }: PpobRetryDialogProps) {
  const queryClient = useQueryClient()
  const [pin, setPin] = useState("")
  const [isRetrying, setIsRetrying] = useState(false)
  const isPinValid = /^\d{4,6}$/.test(pin)

  const close = () => {
    setPin("")
    onClose()
  }

  const handleRetry = async () => {
    if (items.length === 0 || !isPinValid || isRetrying) return
    setIsRetrying(true)
    try {
      const failures = await retryPpobLines(items, pin)
      const succeeded = items.length - failures.length
      if (succeeded > 0) {
        toast.success(ppobRetrySuccessMessage(succeeded))
        // One prefix covers both the detail and the list; both live under
        // `["transactions", ...]`.
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      }
      if (failures.length > 0) toast.error(ppobRetryFailureMessage(failures, items.length))
      // Nothing went through: stay open so the cashier can try again. Otherwise
      // the lines still failed keep their own button on the detail.
      if (succeeded > 0) close()
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <AlertDialog.Backdrop
      isKeyboardDismissDisabled={false}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog aria-label={TITLE}>
          <AlertDialog.Header>
            <AlertDialog.Icon status="accent" />
            <AlertDialog.Heading>{TITLE}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{id.ppobFulfillment.retryPrompt(items.length)}</p>
            <TextField fullWidth value={pin} variant="secondary" onChange={setPin}>
              <Label>{id.ppobFulfillment.pinLabel}</Label>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                placeholder={id.ppobFulfillment.pinPlaceholder}
                type="password"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && isPinValid) {
                    event.preventDefault()
                    handleRetry()
                  }
                }}
              />
            </TextField>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button isDisabled={isRetrying} slot="close" variant="tertiary">
              {id.common.cancel}
            </Button>
            <PendingButton isDisabled={!isPinValid} isPending={isRetrying} onPress={handleRetry}>
              {TITLE}
            </PendingButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
