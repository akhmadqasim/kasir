import { PaymentDialog } from "@/features/cashier/components/payment/payment-dialog"
import type { PrinterSettings } from "@/features/settings/types"
import { OpenShiftDialog } from "@/features/shift/components/open-shift-dialog"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useApiQuery } from "@/hooks/use-api"
import { getPrinterSettings } from "@/lib/api/printers"
import { queryKeys } from "@/lib/api/query-keys"
import { PpobResultDialog } from "./ppob-result-dialog"
import type { PpobCheckoutState } from "./use-ppob-checkout"

interface PpobCheckoutProps {
  checkout: PpobCheckoutState
  /** The result has been read: where the page goes next. */
  onDone: () => void
}

/**
 * The three dialogs a PPOB-page purchase can be in: the shift dialog when no
 * shift is open, the same payment dialog the till uses (handed the line by
 * prop, so the cashier's cart is never touched), then the result.
 */
export function PpobCheckout({ checkout, onDone }: PpobCheckoutProps) {
  // Read once here and cached, like `CashierPage` does, so the result dialog
  // can start printing without one more round trip.
  const { data: printerSettings } = useApiQuery<PrinterSettings>(
    queryKeys.printers.settings,
    getPrinterSettings,
  )
  const autoPrint = printerSettings
    ? !!printerSettings.auto_print && !!printerSettings.printer_id
    : undefined

  const shiftDialogOpen = checkout.sale !== null && checkout.needsShift

  return (
    <>
      <OpenShiftDialog
        open={shiftDialogOpen}
        onOpenChange={(open) => {
          // The dialog also closes itself right after opening a shift; only a
          // close that leaves no shift behind is the cashier backing out.
          if (!open && !useShiftStore.getState().activeShift) checkout.cancel()
        }}
      />

      {checkout.sale && (
        <PaymentDialog
          open={!checkout.needsShift}
          sale={checkout.sale}
          onOpenChange={(open) => {
            if (!open) checkout.cancel()
          }}
          onSuccess={checkout.onPaid}
        />
      )}

      <PpobResultDialog
        open={checkout.result !== null}
        result={checkout.result}
        autoPrint={autoPrint}
        onDone={() => {
          checkout.finish()
          onDone()
        }}
      />
    </>
  )
}
