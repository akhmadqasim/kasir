import type {
  CreateRefundInput,
  ListRefundsInput,
  ListRefundsResult,
  RefundDetailResult,
  RefundResult,
} from "@/features/refunds/types"
import { apiGet, apiPost, type QueryParams } from "./client"

function listQuery(params: ListRefundsInput): QueryParams {
  return {
    page: params.page,
    per_page: params.per_page,
    refund_type: params.refund_type,
    date_from: params.date_from,
    date_to: params.date_to,
  }
}

export function listRefunds(params: ListRefundsInput): Promise<ListRefundsResult> {
  return apiGet<ListRefundsResult>("/refunds", listQuery(params))
}

export function getRefundDetail(refundId: number): Promise<RefundDetailResult> {
  return apiGet<RefundDetailResult>(`/refunds/${refundId}`)
}

/**
 * Book a return or an exchange.
 *
 * There is no `user_id` in the payload any more: the refund is recorded against
 * whoever's session took it. The old command believed the id the browser sent,
 * so a return could be booked under someone else's name.
 */
export function createRefund(input: CreateRefundInput): Promise<RefundResult> {
  return apiPost<RefundResult>("/refunds", input)
}
