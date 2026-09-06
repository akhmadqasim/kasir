import type {
  CreateStockWriteoffInput,
  ListWriteoffsParams,
  ListWriteoffsResult,
  StockWriteoff,
} from "@/features/stock/types"
import { apiDelete, apiGet, apiPost, type QueryParams } from "./client"

/**
 * Stock write-offs.
 *
 * These parameters are camelCase because `ListWriteoffsInput` carries
 * `rename_all = "camelCase"`, unlike the product and transaction filters next
 * to it. The casing follows the Rust struct, one endpoint at a time, rather
 * than a convention this file invents.
 */
function listQuery(params: ListWriteoffsParams): QueryParams {
  return {
    page: params.page,
    perPage: params.perPage,
    status: params.status,
    reason: params.reason,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  }
}

export function listWriteoffs(params: ListWriteoffsParams): Promise<ListWriteoffsResult> {
  return apiGet<ListWriteoffsResult>("/stock/writeoffs", listQuery(params))
}

export function getWriteoffDetail(writeoffId: number): Promise<StockWriteoff> {
  return apiGet<StockWriteoff>(`/stock/writeoffs/${writeoffId}`)
}

/**
 * Record a write-off. Reason `lost` is admin-only, and a cashier's write-off
 * lands `pending` rather than `approved` — the server decides which, so the
 * caller has to read the status back rather than assume it.
 */
export function createWriteoff(input: CreateStockWriteoffInput): Promise<StockWriteoff> {
  return apiPost<StockWriteoff>("/stock/writeoffs", input)
}

export function approveWriteoff(writeoffId: number): Promise<StockWriteoff> {
  return apiPost<StockWriteoff>(`/stock/writeoffs/${writeoffId}/approve`)
}

export function rejectWriteoff(writeoffId: number): Promise<StockWriteoff> {
  return apiPost<StockWriteoff>(`/stock/writeoffs/${writeoffId}/reject`)
}

export function deleteWriteoff(writeoffId: number): Promise<void> {
  return apiDelete<void>(`/stock/writeoffs/${writeoffId}`)
}
