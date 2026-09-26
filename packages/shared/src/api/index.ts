export {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  buildQueryString,
  createApiClient,
  createIdempotencyKey,
  errorMessage,
  hasApiErrorCode,
  isApiError,
} from "./client"
export type {
  ApiClient,
  ApiClientConfig,
  ApiErrorCode,
  FetchLike,
  HttpMethod,
  QueryParamValue,
  QueryParams,
  RequestOptions,
} from "./client"

export { createAuthApi } from "./auth"
export type { AuthApi } from "./auth"

export { createProductsApi } from "./products"
export type { ProductLookupHint, ProductPatch, ProductsApi } from "./products"

export { createStockApi } from "./stock"
export type { StockApi } from "./stock"

export { createStoreApi, publicStoreLogoUrl } from "./store"
export type { StoreApi } from "./store"

export { HEALTH_PATH, probeServer } from "./health"
export type { ProbeOptions, ProbeResult } from "./health"

export { queryKeys } from "./query-keys"
