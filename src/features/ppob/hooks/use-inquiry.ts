import { useTauriMutation } from "@/hooks/use-tauri-command"
import type { InquiryResult } from "../types"

export function usePlnInquiry() {
  return useTauriMutation<InquiryResult, {
    customerId: string
    paymentCode: string
    flagId: string
    amount: number
  }>("ppob_pln_inquiry")
}

export function usePdamInquiry() {
  return useTauriMutation<InquiryResult, {
    customerId: string
    productId: number
    paymentCode: string
  }>("ppob_pdam_inquiry")
}

export function useBpjsInquiry() {
  return useTauriMutation<InquiryResult, {
    customerId: string
    phoneNumber: string
    paymentCode: string
    bpjsType: string
    period: string
  }>("ppob_bpjs_inquiry")
}

export function useEmoneyInquiry() {
  return useTauriMutation<InquiryResult, {
    customerId: string
    productCode: string
  }>("ppob_emoney_inquiry")
}
