import { useTauriMutation } from "@/hooks/use-tauri-command"
import type { PaymentResult } from "../types"

export function usePpobPayment() {
  return useTauriMutation<PaymentResult, {
    serviceType: string
    inquiryId: string
    customerId?: string
    productCode?: string
    paymentCode?: string
    flagId?: string
    phoneNumber?: string
    amount?: number
  }>("ppob_confirm_payment")
}
