import { AlertDialog, Button } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import { id } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { cashDifferenceStatus, cashDifferenceText } from "../../utils"
import type { ShiftSummary } from "../../types"

/**
 * Closing a shift is irreversible, so it takes two confirmations: a summary to
 * read, then a plain "are you sure". `"idle"` means neither dialog is up.
 */
export type CloseStep = "idle" | "review" | "final"

interface CloseShiftConfirmDialogsProps {
  step: CloseStep
  onStepChange: (step: CloseStep) => void
  summary: ShiftSummary
  /** The counted drawer, or `null` when the field was left empty. */
  closingCash: number | null
  /** `closingCash - expectedCash`, or `null` without a count. */
  cashDifference: number | null
  isSubmitting: boolean
  onConfirm: () => void
}

export function CloseShiftConfirmDialogs({
  step,
  onStepChange,
  summary,
  closingCash,
  cashDifference,
  isSubmitting,
  onConfirm,
}: CloseShiftConfirmDialogsProps) {
  return (
    <>
      {/* Step 1 of the close chain: read the numbers back.
          `isKeyboardDismissDisabled={false}` restores Escape-to-cancel, which the
          Radix alert dialog gave for free and HeroUI turns off by default. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={step === "review"}
        onOpenChange={(open) => !open && onStepChange("idle")}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.shift.close.reviewTitle}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.shift.close.reviewTitle}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{id.shift.close.reviewBody}</p>
              <InfoPanel>
                <SummaryList
                  items={[
                    { label: id.shift.close.cashier, value: summary.shift.userName },
                    {
                      label: id.shift.close.totalTransactions,
                      value: formatNumber(summary.totalTransactions),
                    },
                    {
                      label: id.shift.close.expectedCash,
                      value: formatRupiah(summary.expectedCash),
                    },
                    ...(closingCash !== null
                      ? [{ label: id.shift.close.actualCash, value: formatRupiah(closingCash) }]
                      : []),
                    ...(cashDifference !== null
                      ? [
                          {
                            label: id.shift.close.difference,
                            // The same badge as under the count field on the
                            // page. Bare red text on this grey panel fell
                            // short of AA contrast in the light theme.
                            value: (
                              <StatusBadge
                                className="tabular-nums"
                                status={cashDifferenceStatus(cashDifference)}
                              >
                                {cashDifferenceText(cashDifference)}
                              </StatusBadge>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </InfoPanel>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={isSubmitting} slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <Button
                isDisabled={isSubmitting}
                variant="danger"
                onPress={() => onStepChange("final")}
              >
                {id.shift.close.continue}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* Step 2: the last stop before the shift is actually closed. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={step === "final"}
        // ESC tidak menutupnya selagi permintaan berjalan: dialog yang hilang di
        // tengah jalan membuat kasir mengira tutupnya batal, padahal shift
        // tetap tertutup di server.
        onOpenChange={(open) => !open && !isSubmitting && onStepChange("idle")}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.shift.close.finalTitle}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.shift.close.finalTitle}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {/* Satu kalimat, tanpa `Alert` tambahan yang mengulang peringatan
                  yang sudah dibawa ikon `danger` di kepala — DESIGN.md §5.7. */}
              <p>{id.shift.close.finalBody}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              {/* "Batal", bukan "Kembali": tombol ini membuang seluruh rantai,
                  tidak mundur ke langkah ringkasan. */}
              <Button isDisabled={isSubmitting} slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <PendingButton isPending={isSubmitting} variant="danger" onPress={onConfirm}>
                {id.shift.close.confirm}
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
