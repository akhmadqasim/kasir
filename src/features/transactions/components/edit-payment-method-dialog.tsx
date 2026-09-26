import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, Button, Label, Modal, TextArea, TextField } from "@heroui/react"

import { toast } from "@/lib/toast"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { errorMessage } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import { updateTransactionPaymentMethod } from "@/lib/api/transactions"
import {
  SELECTABLE_PAYMENT_METHODS,
  isSelectablePaymentMethod,
  paymentMethodLabel,
} from "@/lib/labels"
import { id } from "@/i18n/id"

const PAYMENT_METHOD_OPTIONS = SELECTABLE_PAYMENT_METHODS.map((method) => ({
  key: method,
  label: paymentMethodLabel(method),
}))

interface EditPaymentMethodDialogProps {
  transactionId: number
  /** The sale's method as stored; `mixed` for a split payment. */
  currentMethod: string
  isSplitPayment: boolean
  isOpen: boolean
  onClose: () => void
}

/** Admin-only: correct the payment method a sale was recorded under. */
export function EditPaymentMethodDialog({
  isOpen,
  onClose,
  ...body
}: EditPaymentMethodDialogProps) {
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={id.transactions.editPaymentMethod}>
          <Modal.CloseTrigger />
          {/* React Aria unmounts the dialog on close, so the form below is
              created afresh on every opening: its starting method is the sale's
              method at that moment, and every way out — Batal, ×, ESC,
              backdrop — forgets the half-typed reason and the pick. */}
          <EditPaymentMethodBody {...body} onClose={onClose} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function EditPaymentMethodBody({
  transactionId,
  currentMethod,
  isSplitPayment,
  onClose,
}: Omit<EditPaymentMethodDialogProps, "isOpen">) {
  const queryClient = useQueryClient()
  // Taken once, when the dialog opens — not on every render, or a refetch of
  // the sale behind the open dialog would swap the select under the admin.
  // `mixed` is not one of the options and the backend rejects it, so a split
  // sale starts empty and the admin picks a real method.
  const [method, setMethod] = useState(() =>
    isSelectablePaymentMethod(currentMethod) ? currentMethod : "",
  )
  const [reason, setReason] = useState("")
  const [isUpdating, setIsUpdating] = useState(false)

  const handleSave = async () => {
    if (!reason.trim()) {
      toast.error(id.validation.reasonRequired)
      return
    }
    setIsUpdating(true)
    try {
      await updateTransactionPaymentMethod(transactionId, method, reason.trim())
      toast.success(id.transactions.editPaymentSuccess)
      onClose()
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      // The payment-method report and the shift's drawer both read this.
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <>
      <Modal.Header>
        <Modal.Heading>{id.transactions.editPaymentMethod}</Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        {isSplitPayment && (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Transaksi ini dibayar dengan beberapa metode. Menyimpan metode tunggal akan
                mengganti seluruh rincian pembayarannya menjadi satu baris sebesar total transaksi.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}
        <OptionSelect
          fullWidth
          label={id.transactions.paymentMethod}
          options={PAYMENT_METHOD_OPTIONS}
          placeholder="Pilih metode pembayaran"
          value={method || null}
          variant="secondary"
          onChange={(key) => setMethod(key ?? "")}
        />
        <TextField fullWidth value={reason} variant="secondary" onChange={setReason}>
          <Label>{id.transactions.editPaymentReason}</Label>
          <TextArea placeholder={id.transactions.editPaymentReasonPlaceholder} rows={3} />
        </TextField>
      </Modal.Body>
      <Modal.Footer>
        <Button isDisabled={isUpdating} slot="close" variant="tertiary">
          {id.common.cancel}
        </Button>
        <PendingButton
          isDisabled={!reason.trim() || !isSelectablePaymentMethod(method)}
          isPending={isUpdating}
          onPress={handleSave}
        >
          {id.common.save}
        </PendingButton>
      </Modal.Footer>
    </>
  )
}
