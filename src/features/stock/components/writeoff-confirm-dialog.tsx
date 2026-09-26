import { AlertDialog, Button } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { id } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { writeoffReasonLabel } from "../labels"
import type { StockWriteoff } from "../types"

export interface WriteoffAction {
  type: "approve" | "reject" | "delete"
  writeoff: StockWriteoff
}

/**
 * Stock moves when a write-off is *created*, not when it is approved:
 * `create_stock_writeoff` decrements it in the same transaction as the insert,
 * `approve_stock_writeoff` only flips the status, and `reject`/`delete` put the
 * stock back — except for refund-originated rows, which never deducted any.
 */
function confirmCopy({ type, writeoff }: WriteoffAction) {
  switch (type) {
    case "approve":
      return {
        title: id.writeoff.confirm.approveTitle,
        action: id.writeoff.confirm.approveAction,
        description: id.writeoff.confirm.approveBody,
      }
    case "reject":
      return {
        title: id.writeoff.confirm.rejectTitle,
        action: id.writeoff.confirm.rejectAction,
        description:
          writeoff.refundId != null
            ? id.writeoff.confirm.rejectFromRefundBody
            : id.writeoff.confirm.rejectBody,
      }
    case "delete":
      return {
        title: id.writeoff.confirm.deleteTitle,
        action: id.common.delete,
        description: id.writeoff.confirm.deleteBody,
      }
  }
}

interface WriteoffConfirmDialogProps {
  /** Tetap terisi selama animasi tutup, supaya isinya tidak mengosong sesaat. */
  action: WriteoffAction | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  isPending: boolean
  onConfirm: () => void
}

export function WriteoffConfirmDialog({
  action,
  isOpen,
  onOpenChange,
  isPending,
  onConfirm,
}: WriteoffConfirmDialogProps) {
  const copy = action ? confirmCopy(action) : null
  const isApprove = action?.type === "approve"

  return (
    <AlertDialog.Backdrop
      isKeyboardDismissDisabled={false}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            {/* Menyetujui tidak merusak apa pun — ikonnya aksen, bukan
                peringatan; tolak dan hapus membuang data. */}
            <AlertDialog.Icon status={isApprove ? "accent" : "danger"} />
            <AlertDialog.Heading>{copy?.title ?? id.common.confirm}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{copy?.description}</p>
            {action && (
              <InfoPanel>
                <SummaryList
                  layout="grid"
                  items={[
                    {
                      label: id.writeoff.confirm.number,
                      value: action.writeoff.writeoffNumber,
                      tone: "mono",
                    },
                    { label: id.writeoff.confirm.product, value: action.writeoff.productName },
                    {
                      label: id.writeoff.confirm.quantity,
                      value: formatNumber(action.writeoff.quantity),
                    },
                    {
                      label: id.writeoff.confirm.reason,
                      value: writeoffReasonLabel(action.writeoff.reason),
                    },
                    {
                      label: id.writeoff.confirm.loss,
                      value: formatRupiah(action.writeoff.lossValue),
                      tone: "danger",
                    },
                  ]}
                />
              </InfoPanel>
            )}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button isDisabled={isPending} slot="close" variant="tertiary">
              {id.common.cancel}
            </Button>
            {/* Setujui memajukan pekerjaan (primary); tolak dan hapus membuang
                data, jadi mengikuti warna ikon di atasnya. Labelnya kata kerja
                aksinya sendiri, bukan "Konfirmasi" yang sama untuk ketiganya. */}
            <PendingButton
              isPending={isPending}
              variant={isApprove ? "primary" : "danger"}
              onPress={onConfirm}
            >
              {copy?.action ?? id.common.confirm}
            </PendingButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
