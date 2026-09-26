import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertDialog, Button, Input, Label, TextField } from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { errorMessage } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import { resolvePpobFulfillment } from "@/lib/api/transactions"
import { id } from "@/i18n/id"
import type { TransactionItem } from "../types"

/** The uncertain PPOB line being settled by hand, and which way. */
export interface PpobResolveTarget {
  item: TransactionItem
  success: boolean
}

interface PpobResolveDialogProps {
  /**
   * Kept by the parent after closing, so the heading and icon do not flip to
   * "Gagal" while the dialog is still fading out.
   */
  target: PpobResolveTarget | null
  isOpen: boolean
  onClose: () => void
}

/**
 * Settle an uncertain PPOB line, only after checking the Mitra history:
 * "gagal" makes it retryable, and a retry pays Mitra again.
 */
export function PpobResolveDialog({ target, isOpen, onClose }: PpobResolveDialogProps) {
  const queryClient = useQueryClient()
  const [serial, setSerial] = useState("")
  const [isResolving, setIsResolving] = useState(false)
  const success = target?.success ?? false

  const close = () => {
    setSerial("")
    onClose()
  }

  const handleResolve = async () => {
    if (!target || isResolving) return
    setIsResolving(true)
    try {
      await resolvePpobFulfillment(target.item.id, target.success, serial.trim() || undefined)
      toast.success(
        target.success ? id.ppobFulfillment.markedSuccess : id.ppobFulfillment.markedFailed,
      )
      close()
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
    } catch (e) {
      toast.error(id.ppobFulfillment.markFailedError(errorMessage(e)))
    } finally {
      setIsResolving(false)
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
        <AlertDialog.Dialog aria-label={id.ppobFulfillment.resolveLabel}>
          <AlertDialog.Header>
            <AlertDialog.Icon status={success ? "success" : "danger"} />
            <AlertDialog.Heading>
              {success
                ? id.ppobFulfillment.resolveSuccessTitle
                : id.ppobFulfillment.resolveFailedTitle}
            </AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>
              {success
                ? id.ppobFulfillment.resolveSuccessPrompt(target?.item.product_name)
                : id.ppobFulfillment.resolveFailedPrompt(target?.item.product_name)}
            </p>
            {success && (
              <TextField fullWidth value={serial} variant="secondary" onChange={setSerial}>
                <Label>{id.ppobFulfillment.serialLabel}</Label>
                <Input placeholder={id.ppobFulfillment.serialPlaceholder} />
              </TextField>
            )}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button isDisabled={isResolving} slot="close" variant="tertiary">
              {id.common.cancel}
            </Button>
            <PendingButton
              isPending={isResolving}
              variant={success ? "primary" : "danger"}
              onPress={handleResolve}
            >
              {success ? id.ppobFulfillment.markSuccess : id.ppobFulfillment.markFailed}
            </PendingButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
