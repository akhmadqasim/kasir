import type {
  CreateStockWriteoffInput,
  ListWriteoffsParams,
  ListWriteoffsResult,
  StockWriteoff,
} from "../types/stock"
import type { ApiClient, QueryParams } from "./client"

/**
 * Stock write-offs.
 *
 * These parameters are camelCase because the Rust `ListWriteoffsInput` carries
 * `rename_all = "camelCase"`, unlike the product filters next to it. The casing
 * follows the Rust struct, one endpoint at a time, rather than a convention
 * this file invents.
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

export function createStockApi(client: ApiClient) {
  return {
    listWriteoffs(params: ListWriteoffsParams): Promise<ListWriteoffsResult> {
      return client.get<ListWriteoffsResult>("/stock/writeoffs", listQuery(params))
    },

    getWriteoff(writeoffId: number): Promise<StockWriteoff> {
      return client.get<StockWriteoff>(`/stock/writeoffs/${writeoffId}`)
    },

    /**
     * Record a write-off. Any logged-in user may call this; the service refuses
     * reason `lost` to a non-admin and a quantity above the current stock. The
     * response carries the status the server decided on.
     */
    createWriteoff(input: CreateStockWriteoffInput): Promise<StockWriteoff> {
      return client.post<StockWriteoff>("/stock/writeoffs", input)
    },
  }
}

export type StockApi = ReturnType<typeof createStockApi>
