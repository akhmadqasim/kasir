import type { CheckoutTransactionInput, TransactionResult } from "@/features/cashier/types"
import type { ReceiptData, ReceiptLine } from "@/features/receipt/types"
import type {
  ListTransactionsInput,
  PaginatedTransactions,
  TransactionDetail,
} from "@/features/transactions/types"
import { apiDelete, apiGet, apiPatch, apiPost, type QueryParams } from "./client"

function listQuery(params: ListTransactionsInput): QueryParams {
  return {
    page: params.page,
    per_page: params.per_page,
    date_from: params.date_from,
    date_to: params.date_to,
    payment_method: params.payment_method,
    status: params.status,
    search: params.search,
  }
}

export function listTransactions(params: ListTransactionsInput): Promise<PaginatedTransactions> {
  return apiGet<PaginatedTransactions>("/transactions", listQuery(params))
}

export function getNextReceiptNumber(): Promise<string> {
  return apiGet<string>("/transactions/next-receipt-number")
}

export function getTransactionDetail(transactionId: number): Promise<TransactionDetail> {
  return apiGet<TransactionDetail>(`/transactions/${transactionId}`)
}

/**
 * Ring up a sale.
 *
 * `idempotencyKey` is not optional and the server rejects the request without
 * it. The key belongs to *the cart*, not to this function call: it is minted
 * once when a cart starts and reused by every attempt to check that cart out.
 * A retry after a lost response therefore replays the first sale instead of
 * ringing up a second one. See `useCartStore`, which owns the key's lifetime.
 */
export function checkoutTransaction(
  input: CheckoutTransactionInput,
  idempotencyKey: string,
): Promise<TransactionResult> {
  return apiPost<TransactionResult>("/transactions", input, { idempotencyKey })
}

/** Void a completed sale. Admin-only, enforced by the service. */
export function voidTransaction(transactionId: number, reason: string): Promise<void> {
  return apiDelete<void>(`/transactions/${transactionId}`, { reason })
}

export function updateTransactionPaymentMethod(
  transactionId: number,
  paymentMethod: string,
  reason: string,
): Promise<void> {
  return apiPatch<void>(`/transactions/${transactionId}/payment-method`, {
    payment_method: paymentMethod,
    reason,
  })
}

/** Everything a receipt needs, for the browser to render. */
export function getReceiptData(transactionId: number): Promise<ReceiptData> {
  return apiGet<ReceiptData>(`/transactions/${transactionId}/receipt`)
}

/**
 * The exact lines the printer would be handed for this sale, for the success
 * dialog's struk preview. `paperWidth` (58 or 80) overrides the store's
 * configured paper size; omitted, the server falls back to that same
 * setting — the one the print button itself uses, so the preview cannot
 * show a different width than what comes out of the printer.
 */
export function getSaleReceiptLines(
  transactionId: number,
  paperWidth?: number | null,
): Promise<ReceiptLine[]> {
  return apiGet<ReceiptLine[]>(`/transactions/${transactionId}/receipt/lines`, {
    paper: paperWidth ?? undefined,
  })
}

/**
 * Re-run a PPOB line whose upstream fulfilment failed after the sale committed.
 *
 * Only valid for an item in `failed`. An item in `processing` is already in
 * flight upstream and the server refuses to claim it twice. `pin` is the
 * cashier's Mitra transaction PIN, typed again for this attempt — the one
 * from the original sale was never kept anywhere to reuse.
 */
export function retryPpobFulfillment(transactionItemId: number, pin: string): Promise<string> {
  return apiPost<string>(`/transaction-items/${transactionItemId}/ppob/retry`, { pin })
}
