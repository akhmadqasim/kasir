/**
 * The one place the frontend talks to the server.
 *
 * Every call goes through {@link request}. That is not tidiness for its own
 * sake: three things have to be true of *every* request and none of them can be
 * left to the caller to remember.
 *
 * 1. **The cookie travels.** Identity lives in an `HttpOnly` session cookie, so
 *    a request sent without credentials is an anonymous request no matter who
 *    is logged in.
 * 2. **A failure is a typed failure.** The server answers every error with
 *    `{code, message}`. Callers branch on `code`; the Indonesian `message` is
 *    for the screen. Parsing that in each caller would mean each caller getting
 *    it slightly differently wrong.
 * 3. **A 401 is handled once.** The session can expire between any two
 *    requests. Handling it here means the login redirect happens from one place
 *    instead of forty.
 *
 * ## The Origin check
 *
 * The server refuses a `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` (or
 * `Referer`) authority is not its own — see `deploy/README.md`. Nothing here
 * sets that header, because nothing *can*: `Origin` is a forbidden header name
 * and `fetch` will not let script set it. What satisfies the check is the URL
 * being same-origin and relative, which makes the browser attach the header
 * itself on exactly the methods the server inspects. Pointing {@link API_BASE_URL}
 * at another host would silently break every write.
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

/**
 * Where the API lives.
 *
 * Relative on purpose — the SPA is served by the same process that serves the
 * API, so a relative path is same-origin from the desktop window, from a tablet
 * on the shop LAN, and from behind nginx, without any of them being configured.
 */
export const API_BASE_URL = "/api"

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
    retryAfterSeconds: number | null = null
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

/** True when `error` is an `ApiError` with this exact code. */
export function hasApiErrorCode(error: unknown, code: ApiErrorCode): boolean {
  return isApiError(error) && error.code === code
}

type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

/**
 * Register what happens when the session turns out to be gone.
 *
 * Installed once at boot by the auth layer, which drops the cached user; the
 * route guard notices and shows the login screen. Doing it by clearing state
 * rather than by navigating is what keeps it from looping: the login screen
 * makes no authenticated request, so there is nothing left to answer 401.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
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

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

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
  return (API_ERROR_CODES as readonly string[]).includes(code)
    ? (code as ApiErrorCode)
    : "internal"
}

/**
 * What to say when the response was not the documented error shape — an nginx
 * error page, a proxy timeout, a body that was cut off mid-flight.
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
    return new ApiError(
      toErrorCode(body.code),
      body.message,
      response.status,
      retryAfter
    )
  }

  return new ApiError(
    fallbackCode(response.status),
    fallbackMessage(response.status),
    response.status,
    retryAfter
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

async function send(
  method: HttpMethod,
  path: string,
  options: RequestOptions,
  init: Pick<RequestInit, "body" | "headers">
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey)
  }

  const url = `${API_BASE_URL}${path}${buildQueryString(options.query)}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: init.body,
      credentials: "include",
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError(
      "network",
      "Tidak dapat menghubungi server. Periksa koneksi jaringan.",
      0
    )
  }

  if (response.status === 401 && options.handleUnauthorized !== false) {
    unauthorizedHandler?.()
  }

  if (!response.ok) {
    throw await toApiError(response)
  }

  return response
}

/** The general form. Prefer the verb helpers below. */
export async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const hasBody = options.body !== undefined
  const response = await send(method, path, options, {
    body: hasBody ? JSON.stringify(options.body) : undefined,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
  })

  return readBody<T>(response)
}

export function apiGet<T>(path: string, query?: QueryParams, options: RequestOptions = {}) {
  return request<T>("GET", path, { ...options, query })
}

export function apiPost<T>(path: string, body?: unknown, options: RequestOptions = {}) {
  return request<T>("POST", path, { ...options, body })
}

export function apiPut<T>(path: string, body?: unknown, options: RequestOptions = {}) {
  return request<T>("PUT", path, { ...options, body })
}

export function apiPatch<T>(path: string, body?: unknown, options: RequestOptions = {}) {
  return request<T>("PATCH", path, { ...options, body })
}

export function apiDelete<T>(path: string, body?: unknown, options: RequestOptions = {}) {
  return request<T>("DELETE", path, { ...options, body })
}

/**
 * Upload a file as `multipart/form-data`.
 *
 * No `Content-Type` is set: the browser has to write it itself so that the
 * multipart boundary in the header matches the one in the body.
 */
export function apiUpload<T>(
  path: string,
  file: File | Blob,
  fieldName = "file",
  options: RequestOptions = {}
): Promise<T> {
  const form = new FormData()
  form.append(fieldName, file)

  return send("POST", path, options, { body: form }).then(readBody<T>)
}

/** The filename the server suggested, if it sent one. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const quoted = /filename="([^"]+)"/.exec(header)
  if (quoted) return quoted[1]
  const bare = /filename=([^;]+)/.exec(header)
  return bare ? bare[1].trim() : null
}

/**
 * Fetch a file and hand it to the browser's download folder.
 *
 * Deliberately not a plain `<a href>`: the request has to carry the session
 * cookie and a failure has to surface as an {@link ApiError} the screen can show,
 * rather than as a browser page navigating away to a JSON error body.
 *
 * The name comes from the server's `Content-Disposition`. It is a suggestion to
 * the browser, never a path this application resolves.
 */
export async function apiDownload(
  path: string,
  fallbackFilename: string,
  options: RequestOptions = {}
): Promise<string> {
  const response = await send("GET", path, options, {})
  const blob = await response.blob()
  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ??
    fallbackFilename

  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Revoking synchronously can cancel a download that has not started yet in
    // some browsers, so give the click a turn of the event loop first.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return filename
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
