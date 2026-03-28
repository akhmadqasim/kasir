import { useTauriMutation } from "@/hooks/use-tauri-command"
import type { InquiryResult, PaymentResult } from "../types"

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

export function usePpInquiry() {
  return useTauriMutation<InquiryResult, {
    customerId: string
    paymentPointGroupId: number
    productCode?: string
  }>("ppob_pp_inquiry")
}

export function useTransferInquiry() {
  return useTauriMutation<InquiryResult, {
    channelId: string
    nomorRekening: string
    amount: number
    channelName: string
    deskripsi: string
    namaPengirim: string
    notelpPengirim: string
  }>("ppob_transfer_inquiry")
}

export function useEmoneyInquiry() {
  return useTauriMutation<InquiryResult, {
    customerId: string
    productCode: string
  }>("ppob_emoney_inquiry")
}

export function usePulsaPurchase() {
  return useTauriMutation<PaymentResult, {
    phoneNumber: string
    productCode: string
    productId: number
    productType: string
  }>("ppob_pulsa_purchase")
}
