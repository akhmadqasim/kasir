import { vi, type Mock } from "vitest"

/**
 * A stand-in for the server, for tests that used to mock `invoke`.
 *
 * Those tests asserted on a command name and an argument object. The equivalent
 * question now is which request went out — method, path, query, body — so this
 * records exactly that and lets a test answer it without knowing that `fetch`
 * was involved.
 *
 * Routes are written the way they read in the route table:
 *
 * ```ts
 * const api = installApiMock({
 *   "GET /products": PRODUCTS,
 *   "POST /products": (call) => ({ ...PRODUCT, name: call.body.name }),
 *   "DELETE /products/*": null,
 * })
 * ```
 *
 * A `*` matches exactly one path segment, which is how an id or a filename in
 * the URL is expressed. An unmatched request is a test failure rather than a
 * silent `undefined`: under the old mock, a forgotten command quietly resolved
 * to `null` and the screen rendered an empty state that looked deliberate.
 */

export interface ApiCall {
  method: string
  /** Path below `/api`, without the query string. */
  path: string
  query: URLSearchParams
  /** Parsed JSON body, or `undefined` for a request that carried none. */
  body: unknown
  headers: Headers
}

/**
 * What a route answers with: a value, or a function of the request.
 *
 * Written as a union of a call signature and a set of plain value types rather
 * than `unknown | ((call) => unknown)`, because `unknown` swallows the union
 * and takes the contextual type of the arrow with it — every inline responder
 * would have to annotate its own parameter.
 */
export type ApiResponder =
  | ((call: ApiCall) => unknown)
  | string
  | number
  | boolean
  | null
  | undefined
  | object

export interface ApiErrorResponse {
  status: number
  code: string
  message: string
}

/** Mark a route as failing, in the shape the server actually uses. */
export function apiFailure(
  status: number,
  code: string,
  message: string
): ApiErrorResponse {
  return { status, code, message }
}

function isApiFailure(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  )
}

export type ApiRoutes = Record<string, ApiResponder>

export interface ApiMock {
  /** Every request that has been made, in order. */
  readonly calls: ApiCall[]
  /** Requests matching `"METHOD /path"`, using the same `*` wildcard as routes. */
  callsFor(route: string): ApiCall[]
  /** The most recent matching request, or `undefined`. */
  lastCall(route: string): ApiCall | undefined
  /** Add or replace a route after installation. */
  route(route: string, responder: ApiResponder): void
  /** The underlying `fetch` mock, for the rare assertion that needs it. */
  readonly fetchMock: Mock
}

function matches(pattern: string, method: string, path: string): boolean {
  const [patternMethod, patternPath] = pattern.split(" ")
  if (patternMethod !== method) return false

  const patternSegments = patternPath.split("/")
  const pathSegments = path.split("/")
  if (patternSegments.length !== pathSegments.length) return false

  return patternSegments.every(
    (segment, index) => segment === "*" || segment === pathSegments[index]
  )
}

function jsonResponse(body: unknown): Response {
  if (body === undefined || body === null) {
    return new Response(null, { status: 204 })
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(failure: ApiErrorResponse): Response {
  return new Response(
    JSON.stringify({ code: failure.code, message: failure.message }),
    { status: failure.status, headers: { "Content-Type": "application/json" } }
  )
}

/**
 * Install the mock on `globalThis.fetch` and return a handle to it.
 *
 * `vi.restoreAllMocks` (or vitest's own teardown) puts the real `fetch` back;
 * nothing here has to be undone by hand.
 */
export function installApiMock(routes: ApiRoutes = {}): ApiMock {
  const table = new Map<string, ApiResponder>(Object.entries(routes))
  const calls: ApiCall[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input.toString()
    // Relative by design — the client only ever builds same-origin paths.
    const url = new URL(rawUrl, "http://localhost")
    const method = (init?.method ?? "GET").toUpperCase()
    const path = url.pathname.replace(/^\/api/, "")

    let body: unknown
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    } else if (init?.body !== undefined && init?.body !== null) {
      body = init.body
    }

    const call: ApiCall = {
      method,
      path,
      query: url.searchParams,
      body,
      headers: new Headers(init?.headers),
    }
    calls.push(call)

    for (const [pattern, responder] of table) {
      if (!matches(pattern, method, path)) continue
      const result =
        typeof responder === "function"
          ? (responder as (c: ApiCall) => unknown)(call)
          : responder
      const resolved = await result
      return isApiFailure(resolved) ? errorResponse(resolved) : jsonResponse(resolved)
    }

    throw new Error(
      `Tidak ada rute mock untuk ${method} ${path}. Tambahkan di installApiMock().`
    )
  })

  vi.stubGlobal("fetch", fetchMock)

  return {
    calls,
    callsFor: (route) => calls.filter((call) => matches(route, call.method, call.path)),
    lastCall(route) {
      const found = this.callsFor(route)
      return found[found.length - 1]
    },
    route: (route, responder) => {
      table.set(route, responder)
    },
    fetchMock,
  }
}
