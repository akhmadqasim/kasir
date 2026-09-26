import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertDialog, Button, Label, TextArea, TextField } from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { errorMessage } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import { voidTransaction } from "@/lib/api/transactions"
import { id } from "@/i18n/id"

interface VoidTransactionDialogProps {
  transactionId: number
  isOpen: boolean
  onClose: () => void
  /** Runs after the sale is voided, once this dialog has closed. */
  onVoided: () => void
}

/** Admin-only: void a sale, with a required reason. */
export function VoidTransactionDialog({
  transactionId,
  isOpen,
  onClose,
  onVoided,
}: VoidTransactionDialogProps) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const close = () => {
    setReason("")
    onClose()
  }

  const handleDelete = async () => {
    if (!reason.trim()) {
      toast.error(id.validation.reasonRequired)
      return
    }
    setIsDeleting(true)
    try {
      await voidTransaction(transactionId, reason.trim())
      toast.success(id.transactions.deleteSuccess)
      close()
      onVoided()
      // Voiding a sale puts the stock back and changes every net figure.
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      // The open shift's expected cash leaves voided sales out.
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setIsDeleting(false)
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
        <AlertDialog.Dialog aria-label={id.transactions.deleteTransaction}>
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{id.transactions.deleteTransaction}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{id.transactions.deleteConfirm}</p>
            <TextField fullWidth value={reason} variant="secondary" onChange={setReason}>
              <Label>{id.transactions.deleteReason}</Label>
              <TextArea placeholder={id.transactions.deleteReasonPlaceholder} rows={3} />
            </TextField>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            {/* Closing through the backdrop's `onOpenChange` already clears the reason. */}
            <Button isDisabled={isDeleting} slot="close" variant="tertiary">
              {id.common.cancel}
            </Button>
            <PendingButton
              isDisabled={!reason.trim()}
              isPending={isDeleting}
              variant="danger"
              onPress={handleDelete}
            >
              {id.common.delete}
            </PendingButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
