/**
 * The one way any kasir client talks to the server.
 *
 * Copied from the desktop's `src/lib/api/client.ts` and made platform-neutral:
 * the desktop knows its API lives at a relative `/api` and uses the browser's
 * global `fetch`; the mobile app has to be *told* which desktop on the LAN it
 * is talking to, and runs on a `fetch` that behaves differently in one way that
 * matters (see "The Origin header" below). Both facts are therefore injected
 * through {@link ApiClientConfig} instead of being assumed.
 *
 * Three things stay true of every request, whoever the caller is:
 *
 * 1. **The cookie travels.** Identity is an `HttpOnly` session cookie, so the
 *    request is sent with `credentials: "include"`. The browser and the native
 *    cookie jar both honour that.
 * 2. **A failure is a typed failure.** The server answers every error with
 *    `{code, message}`. Callers branch on `code`; the Indonesian `message` is
 *    for the screen.
 * 3. **A 401 is handled once**, via {@link ApiClientConfig.onUnauthorized}.
 *
 * ## The Origin header
 *
 * The server refuses a `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` (or
 * `Referer`) authority is not its own `host[:port]`
 * (`src-tauri/src/http/middleware.rs`, `check_origin`). It also refuses a write
 * that carries *neither* header.
 *
 * - In a browser, nothing needs doing: `Origin` is a forbidden header name, the
 *   page is same-origin with the API, and the browser attaches it itself.
 * - In React Native there is no page and no origin, so a native `fetch` sends no
 *   `Origin` at all — and every write would be rejected as CSRF. Native `fetch`
 *   is *allowed* to set `Origin`, so the mobile client passes it explicitly via
 *   {@link ApiClientConfig.headers}, set to the server's own authority:
 *   `http://<host>:<port>`. That is the only value the check accepts without
 *   `KASIR_ALLOWED_ORIGINS`.
 */

/** The `code` field of an error body, plus the one failure the server cannot report. */
export type ApiErrorCode =
  | "auth"
  | "forbidden"
  | "csrf"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "bad_request"
  | "validation"
  | "internal"
  /** The request never got an answer: the server is down, or the LAN dropped. */
  | "network"

const API_ERROR_CODES: readonly ApiErrorCode[] = [
  "auth",
  "forbidden",
  "csrf",
  "not_found",
  "conflict",
  "rate_limited",
  "bad_request",
  "validation",
  "internal",
  "network",
]

/** A failed request, carrying the machine-readable reason it failed. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  /** HTTP status, or `0` when the request never reached the server. */
  readonly status: number
  /** Seconds the server asked us to wait. Only the login backoff sets it. */
  readonly retryAfterSeconds: number | null

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * Text to show the user for anything that was thrown.
 *
 * An {@link ApiError} already carries Indonesian prose written for the screen.
 * Everything else is a programming fault that should not reach the user, but a
 * message reading `[object Object]` helps nobody either.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** True when `error` is an `ApiError` with this exact code. */
export function hasApiErrorCode(error: unknown, code: ApiErrorCode): boolean {
  return isApiError(error) && error.code === code
}

export type QueryParamValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryParamValue>

/**
 * `?a=1&b=2`, or an empty string.
 *
 * `undefined` and `null` are dropped rather than sent as the text "undefined".
 * An empty string is kept, because "search for nothing" and "do not filter" are
 * the same thing to every endpoint here and both are spelled `""`.
 */
export function buildQueryString(params?: QueryParams): string {
  if (!params) return ""

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }

  const encoded = search.toString()
  return encoded ? `?${encoded}` : ""
}

export interface RequestOptions {
  /** Appended as a query string. */
  query?: QueryParams
  /** Serialised as a JSON body. `undefined` sends no body at all. */
  body?: unknown
  /**
   * Required by `POST /transactions`, `/ppob/payments` and `/ppob/topups`.
   * One key per user attempt, reused by every retry of that attempt.
   */
  idempotencyKey?: string
  signal?: AbortSignal
  /**
   * Set `false` for the two requests that must not trigger the global session
   * handler: `GET /auth/me` at boot (a 401 there just means "nobody is logged
   * in") and `POST /auth/login` (a 401 there means the PIN was wrong).
   */
  handleUnauthorized?: boolean
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** The subset of `fetch` this client relies on. `globalThis.fetch` satisfies it. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ApiClientConfig {
  /**
   * Where `/api` lives, *including* the `/api` prefix and without a trailing
   * slash — `"/api"` on the desktop, `"http://192.168.1.10:17720/api"` on a
   * phone. A function, because the mobile app lets the user change it at
   * runtime and the client must follow without being rebuilt.
   */
  baseUrl: () => string
  /** Defaults to `globalThis.fetch`. Injected so tests and platforms can swap it. */
  fetch?: FetchLike
  /**
   * Extra headers on every request. The mobile client uses this for `Origin`
   * (see the module doc). A function for the same reason as `baseUrl`.
   */
  headers?: () => Record<string, string>
  /**
   * What happens when the session turns out to be gone. Called at most once per
   * failed request, before the {@link ApiError} is thrown, and never for a
   * request that opted out via {@link RequestOptions.handleUnauthorized}.
   */
  onUnauthorized?: () => void
}

/** What the server sends when something goes wrong. */
interface ErrorBody {
  code: string
  message: string
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null) return false
  const body = value as Record<string, unknown>
  return typeof body.code === "string" && typeof body.message === "string"
}

function toErrorCode(code: string): ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(code) ? (code as ApiErrorCode) : "internal"
}

/**
 * What to say when the response was not the documented error shape — a proxy
 * error page, a timeout, a body that was cut off mid-flight.
 */
function fallbackMessage(status: number): string {
  if (status === 401) return "Sesi tidak valid. Silakan login ulang."
  if (status === 403) return "Anda tidak berhak melakukan tindakan ini."
  if (status === 404) return "Data tidak ditemukan."
  if (status === 413) return "Berkas terlalu besar untuk diunggah."
  if (status >= 500) return "Terjadi kesalahan pada server. Coba lagi atau hubungi admin."
  return "Permintaan tidak dapat diproses."
}

/** A status with no `{code, message}` body still has to become *some* code. */
function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return "auth"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 422) return "validation"
  if (status === 429) return "rate_limited"
  if (status >= 400 && status < 500) return "bad_request"
  return "internal"
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("Retry-After")
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) ? seconds : null
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // A non-JSON error body is not a client problem to solve; fall through to
    // the status-derived message.
  }

  const retryAfter = parseRetryAfter(response)

  if (isErrorBody(body)) {
    return new ApiError(toErrorCode(body.code), body.message, response.status, retryAfter)
  }

  return new ApiError(
    fallbackCode(response.status),
    fallbackMessage(response.status),
    response.status,
    retryAfter,
  )
}

/**
 * A body of `undefined` for `204 No Content`, the parsed JSON otherwise.
 *
 * Handlers that return `StatusCode::NO_CONTENT` send no body at all, and the
 * mutations that call them declare `Promise<void>`. Asking `json()` for a body
 * that is not there throws.
 */
async function readBody<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.headers.get("Content-Length") === "0") {
    return undefined as T
  }

  const text = await response.text()
  if (text.length === 0) {
    return undefined as T
  }

  return JSON.parse(text) as T
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  )
}

export const NETWORK_ERROR_MESSAGE = "Tidak dapat menghubungi server. Periksa koneksi jaringan."

/** A configured client. Build one with {@link createApiClient}. */
export interface ApiClient {
  /** The general form. Prefer the verb helpers. */
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>
  get<T>(path: string, query?: QueryParams, options?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchImpl: FetchLike =
    config.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function send(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    init: Pick<RequestInit, "body" | "headers">,
  ): Promise<Response> {
    const headers = new Headers(config.headers?.())
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    headers.set("Accept", "application/json")
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey)
    }

    const url = `${config.baseUrl()}${path}${buildQueryString(options.query)}`

    let response: Response
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: init.body,
        credentials: "include",
        signal: options.signal,
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      throw new ApiError("network", NETWORK_ERROR_MESSAGE, 0)
    }

    if (response.status === 401 && options.handleUnauthorized !== false) {
      config.onUnauthorized?.()
    }

    if (!response.ok) {
      throw await toApiError(response)
    }

    return response
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const hasBody = options.body !== undefined
    const response = await send(method, path, options, {
      body: hasBody ? JSON.stringify(options.body) : undefined,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    })

    return readBody<T>(response)
  }

  return {
    request,
    get: (path, query, options = {}) => request("GET", path, { ...options, query }),
    post: (path, body, options = {}) => request("POST", path, { ...options, body }),
    put: (path, body, options = {}) => request("PUT", path, { ...options, body }),
    patch: (path, body, options = {}) => request("PATCH", path, { ...options, body }),
    delete: (path, body, options = {}) => request("DELETE", path, { ...options, body }),
  }
}

/**
 * A fresh `Idempotency-Key`.
 *
 * `crypto.randomUUID` needs a secure context, which plain HTTP on the shop LAN
 * is not, so there is a fallback. The key only has to be unique among the keys
 * this shop generates, not unguessable — the server scopes it by endpoint and
 * by user before storing it.
 */
export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  const random = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${random}-${Math.random().toString(36).slice(2)}`
}
