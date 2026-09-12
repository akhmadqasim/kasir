import { describe, expect, it, vi } from "vitest"

import { ApiError, buildQueryString, createApiClient, hasApiErrorCode, isApiError } from "../client"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorBody(status: number, code: string, message: string): Response {
  return jsonResponse({ code, message }, status)
}

/** One fake `fetch` per test, recording what it was called with. */
function fakeFetch(answer: Response | Error | ((url: string, init: RequestInit) => Response)) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (answer instanceof Error) throw answer
    if (typeof answer === "function") return answer(url, init)
    return answer
  })
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("request succeeded but was expected to fail")
}

describe("createApiClient", () => {
  it("prefixes the injected base URL and appends the query string", async () => {
    const fetch = fakeFetch(jsonResponse({ data: [] }))
    const client = createApiClient({ baseUrl: () => "http://10.0.0.5:17720/api", fetch })

    await client.get("/products", { query: "beras", page: 2, category_id: null })

    expect(fetch).toHaveBeenCalledWith(
      "http://10.0.0.5:17720/api/products?query=beras&page=2",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    )
  })

  it("re-reads the base URL on every call so a changed server takes effect at once", async () => {
    const fetch = fakeFetch(() => jsonResponse(true))
    let base = "http://a:1/api"
    const client = createApiClient({ baseUrl: () => base, fetch })

    await client.get("/x")
    base = "http://b:2/api"
    await client.get("/x")

    expect(fetch.mock.calls[0]?.[0]).toBe("http://a:1/api/x")
    expect(fetch.mock.calls[1]?.[0]).toBe("http://b:2/api/x")
  })

  it("sends the injected headers — this is how the native client sets Origin", async () => {
    const fetch = fakeFetch(jsonResponse({ id: 1 }))
    const client = createApiClient({
      baseUrl: () => "http://10.0.0.5:17720/api",
      fetch,
      headers: () => ({ Origin: "http://10.0.0.5:17720" }),
    })

    await client.post("/products", { name: "Gula" })

    const init = fetch.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get("Origin")).toBe("http://10.0.0.5:17720")
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("Accept")).toBe("application/json")
    expect(init?.body).toBe(JSON.stringify({ name: "Gula" }))
  })

  it("turns a {code, message} body into a typed ApiError", async () => {
    const client = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(errorBody(422, "validation", "Nama produk wajib diisi")),
    })

    const error = await failureOf(client.get("/products"))

    expect(isApiError(error)).toBe(true)
    expect(error).toMatchObject({
      code: "validation",
      message: "Nama produk wajib diisi",
      status: 422,
    })
    expect(hasApiErrorCode(error, "validation")).toBe(true)
  })

  it("keeps every documented code as is and maps unknown ones to internal", async () => {
    const codes = [
      ["auth", 401],
      ["forbidden", 403],
      ["csrf", 403],
      ["not_found", 404],
      ["conflict", 409],
      ["rate_limited", 429],
      ["bad_request", 400],
      ["validation", 422],
      ["internal", 500],
    ] as const

    for (const [code, status] of codes) {
      const client = createApiClient({
        baseUrl: () => "/api",
        fetch: fakeFetch(errorBody(status, code, "pesan")),
      })
      expect((await failureOf(client.get("/x"))).code).toBe(code)
    }

    const unknown = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(errorBody(418, "teapot", "pesan")),
    })
    expect((await failureOf(unknown.get("/x"))).code).toBe("internal")
  })

  it("derives code and Indonesian message from the status when the body is not JSON", async () => {
    const client = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(new Response("<html>502</html>", { status: 502 })),
    })

    const error = await failureOf(client.get("/x"))

    expect(error.code).toBe("internal")
    expect(error.status).toBe(502)
    expect(error.message).toMatch(/server/i)
  })

  it("reads Retry-After for the login backoff", async () => {
    const client = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(
        new Response(JSON.stringify({ code: "rate_limited", message: "Tunggu" }), {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
      ),
    })

    expect((await failureOf(client.post("/auth/login", {}))).retryAfterSeconds).toBe(30)
  })

  it("reports a fetch that never reached the server as a network error", async () => {
    const client = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(new TypeError("Network request failed")),
    })

    const error = await failureOf(client.get("/x"))

    expect(error.code).toBe("network")
    expect(error.status).toBe(0)
  })

  it("lets an abort propagate untouched", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
    const client = createApiClient({ baseUrl: () => "/api", fetch: fakeFetch(abort) })

    await expect(client.get("/x")).rejects.toBe(abort)
  })

  it("calls onUnauthorized once for a 401, except where the request opted out", async () => {
    const onUnauthorized = vi.fn()
    const client = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(errorBody(401, "auth", "Sesi tidak valid")),
      onUnauthorized,
    })

    await failureOf(client.get("/products"))
    expect(onUnauthorized).toHaveBeenCalledTimes(1)

    await failureOf(client.get("/auth/me", undefined, { handleUnauthorized: false }))
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it("resolves undefined for 204 and for an empty body", async () => {
    const noContent = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(new Response(null, { status: 204 })),
    })
    await expect(noContent.post("/auth/logout")).resolves.toBeUndefined()

    const empty = createApiClient({
      baseUrl: () => "/api",
      fetch: fakeFetch(new Response("", { status: 200 })),
    })
    await expect(empty.delete("/x")).resolves.toBeUndefined()
  })

  it("puts the Idempotency-Key on the wire when given", async () => {
    const fetch = fakeFetch(jsonResponse({}))
    const client = createApiClient({ baseUrl: () => "/api", fetch })

    await client.post("/transactions", {}, { idempotencyKey: "abc" })

    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Idempotency-Key")).toBe("abc")
  })
})

describe("buildQueryString", () => {
  it("drops null and undefined but keeps empty strings and false", () => {
    expect(buildQueryString({ a: undefined, b: null, c: "", d: false, e: 0 })).toBe(
      "?c=&d=false&e=0",
    )
  })

  it("returns an empty string when there is nothing to send", () => {
    expect(buildQueryString()).toBe("")
    expect(buildQueryString({ a: undefined })).toBe("")
  })
})
