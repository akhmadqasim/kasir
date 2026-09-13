import { useApiMutation } from "@/hooks/use-api"
import {
  bpjsInquiry,
  emoneyInquiry,
  paymentPointInquiry,
  pdamInquiry,
  plnInquiry,
  type BpjsInquiryInput,
  type EmoneyInquiryInput,
  type PaymentPointInquiryInput,
  type PdamInquiryInput,
  type PlnInquiryInput,
} from "@/lib/api/ppob"
import type { InquiryResult } from "../types"

/**
 * "What does this customer owe?" — a read upstream, but a `POST` here because it
 * carries a body and the provider bills for it. Repeating one costs a query,
 * not money, which is why none of these takes an idempotency key.
 */

export function usePlnInquiry() {
  return useApiMutation<InquiryResult, PlnInquiryInput>(plnInquiry)
}

export function usePdamInquiry() {
  return useApiMutation<InquiryResult, PdamInquiryInput>(pdamInquiry)
}

export function useBpjsInquiry() {
  return useApiMutation<InquiryResult, BpjsInquiryInput>(bpjsInquiry)
}

export function useEmoneyInquiry() {
  return useApiMutation<InquiryResult, EmoneyInquiryInput>(emoneyInquiry)
}

export function usePaymentPointInquiry() {
  return useApiMutation<InquiryResult, PaymentPointInquiryInput>(paymentPointInquiry)
}
