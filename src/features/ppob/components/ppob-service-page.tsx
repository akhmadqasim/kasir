import { useNavigate } from "react-router-dom"

import { PpobCheckout } from "./checkout/ppob-checkout"
import { usePpobCheckout } from "./checkout/use-ppob-checkout"
import { PpobQuickAccess } from "./quick-access/ppob-quick-access"
import type { ServiceType } from "./quick-access/types"

/**
 * One quick-access service as a full page: the inquiry form on the left, the
 * confirm card on the right, and — new — the payment right here. The confirmed
 * line is paid on this page in the `ppob` channel; it never enters the
 * cashier's cart, and the cashier is never sent to the sales screen.
 */
export function PpobServicePage({ service }: { service: ServiceType }) {
  const navigate = useNavigate()
  const checkout = usePpobCheckout()

  return (
    <>
      <PpobQuickAccess
        initialService={service}
        onBack={() => navigate("/ppob")}
        onPay={checkout.begin}
        showSaldoBar={false}
        wideLayout
      />
      <PpobCheckout checkout={checkout} onDone={() => navigate("/ppob")} />
    </>
  )
}
