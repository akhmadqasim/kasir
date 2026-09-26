import { useState } from "react"
import { AlertDialog, Button } from "@heroui/react"

import { id } from "@/i18n/id"
import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { errorMessage } from "@/lib/api/client"
import { deleteCashFlow } from "@/lib/api/shifts"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import type { CashFlow } from "../../types"

interface DeleteCashFlowDialogProps {
  /** The entry to delete; `null` keeps the dialog closed. */
  cashFlow: CashFlow | null
  onClose: () => void
  /** Called once the server has deleted `cashFlow`, after the dialog closes. */
  onDeleted: (cashFlow: CashFlow) => void
}

export function DeleteCashFlowDialog({ cashFlow, onClose, onDeleted }: DeleteCashFlowDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!cashFlow) return
    setIsDeleting(true)
    try {
      await deleteCashFlow(cashFlow.id)
    } catch (err) {
      toast.error(id.shift.cashFlowDeleteFailed(errorMessage(err)))
      return
    } finally {
      setIsDeleting(false)
    }
    // The row is gone either way; a failed reload afterwards must not keep the
    // dialog up and invite a retry that can only answer "not found".
    toast.success(id.shift.cashFlowDeleted)
    onClose()
    onDeleted(cashFlow)
  }

  return (
    <AlertDialog.Backdrop
      isKeyboardDismissDisabled={false}
      isOpen={!!cashFlow}
      onOpenChange={(open) => !open && !isDeleting && onClose()}
    >
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog aria-label="Hapus Arus Kas">
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>Hapus Arus Kas</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>Entri uang masuk/keluar ini akan dihapus dari shift yang sedang berjalan.</p>
            {cashFlow && (
              <InfoPanel>
                <SummaryList
                  layout="grid"
                  items={[
                    {
                      label: "Jenis",
                      value: cashFlow.flowType === "in" ? "Uang Masuk" : "Uang Keluar",
                    },
                    { label: "Nominal", value: formatRupiah(cashFlow.amount) },
                    { label: "Keterangan", value: cashFlow.description },
                  ]}
                />
              </InfoPanel>
            )}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button isDisabled={isDeleting} slot="close" variant="tertiary">
              Batal
            </Button>
            <PendingButton isPending={isDeleting} variant="danger" onPress={handleDelete}>
              Hapus
            </PendingButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
