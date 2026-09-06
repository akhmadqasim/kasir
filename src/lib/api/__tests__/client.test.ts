import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  buildQueryString,
  createIdempotencyKey,
  errorMessage,
  hasApiErrorCode,
  isApiError,
  setUnauthorizedHandler,
} from "../client"

/** One `fetch` stub per test, answering with whatever the test hands it. */
function stubFetch(response: Response | Error) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

/** The `ApiError` a request rejected with. Fails the test if it resolved instead. */
async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("Permintaan berhasil, padahal seharusnya gagal")
}

function errorBody(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

describe("pemetaan error", () => {
  it("mengubah body {code, message} jadi ApiError bertipe", async () => {
    stubFetch(errorBody(422, "validation", "Nama toko tidak boleh kosong"))

    const error = await failureOf(apiGet("/store"))

    expect(isApiError(error)).toBe(true)
    expect(error).toMatchObject({
      code: "validation",
      message: "Nama toko tidak boleh kosong",
      status: 422,
    })
  })

  it("menyimpan seluruh kode yang didokumentasikan apa adanya", async () => {
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
      stubFetch(errorBody(status, code, "pesan"))
      const error = await failureOf(apiGet("/anything"))
      expect(error.code).toBe(code)
    }
  })

  /**
   * A code this client does not know is still a failure, and calling it
   * `internal` is the honest answer: nothing here can act on it.
   */
  it("menganggap kode tak dikenal sebagai internal", async () => {
    stubFetch(errorBody(500, "teapot", "?"))

    const error = await failureOf(apiGet("/anything"))

    expect(error.code).toBe("internal")
    expect(error.message).toBe("?")
  })

  /**
   * An nginx error page or a truncated body has no `code` to read. The status
   * still has to become something a caller can branch on, and the message has
   * to be readable Indonesian rather than a fragment of HTML.
   */
  it("menurunkan kode dan pesan dari status saat body bukan JSON", async () => {
    stubFetch(new Response("<html>502 Bad Gateway</html>", { status: 502 }))

    const error = await failureOf(apiGet("/anything"))

    expect(error.code).toBe("internal")
    expect(error.message).not.toContain("html")
    expect(error.message).toContain("server")
  })

  it("menandai kegagalan jaringan dengan kode network", async () => {
    stubFetch(new TypeError("Failed to fetch"))

    const error = await failureOf(apiGet("/anything"))

    expect(error.code).toBe("network")
    expect(error.status).toBe(0)
    expect(error.message).toContain("jaringan")
  })

  it("membaca Retry-After dari backoff login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "rate_limited", message: "tunggu" }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "40" },
          }),
      ),
    )

    const error = await failureOf(apiPost("/auth/login", {}))

    expect(error.code).toBe("rate_limited")
    expect(error.retryAfterSeconds).toBe(40)
  })

  it("hasApiErrorCode hanya cocok untuk ApiError dengan kode yang sama", () => {
    const error = new ApiError("forbidden", "tidak berhak", 403)

    expect(hasApiErrorCode(error, "forbidden")).toBe(true)
    expect(hasApiErrorCode(error, "auth")).toBe(false)
    expect(hasApiErrorCode(new Error("biasa"), "auth")).toBe(false)
  })

  it("errorMessage memberi teks untuk apa pun yang dilempar", () => {
    expect(errorMessage(new ApiError("auth", "sesi habis", 401))).toBe("sesi habis")
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("string mentah")).toBe("string mentah")
  })
})

describe("penanganan 401 terpusat", () => {
  let onUnauthorized: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    onUnauthorized = vi.fn<() => void>()
    setUnauthorizedHandler(onUnauthorized)
  })

  it("memanggil handler sekali untuk setiap 401", async () => {
    stubFetch(errorBody(401, "auth", "Sesi tidak valid. Silakan login ulang."))

    await apiGet("/products").catch(() => {})

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  /**
   * The two requests that must not trigger it: `/auth/me` at boot answers 401
   * for a user who simply has not logged in yet, and a wrong PIN answers 401 on
   * a screen the user is already looking at. Treating either as "your session
   * expired" is how a redirect loop starts.
   */
  it("melewati handler saat pemanggil menolaknya", async () => {
    stubFetch(errorBody(401, "auth", "Sesi tidak valid. Silakan login ulang."))

    await apiGet("/auth/me", undefined, { handleUnauthorized: false }).catch(() => {})

    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it("tidak memanggil handler untuk status selain 401", async () => {
    stubFetch(errorBody(403, "forbidden", "Anda tidak berhak"))

    await apiGet("/settings").catch(() => {})

    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it("tetap melempar ApiError setelah handler dijalankan", async () => {
    stubFetch(errorBody(401, "auth", "Sesi tidak valid. Silakan login ulang."))

    const error = await failureOf(apiGet("/products"))

    expect(error.code).toBe("auth")
    expect(onUnauthorized).toHaveBeenCalled()
  })
})

describe("bentuk permintaan", () => {
  it("mengirim cookie sesi pada setiap permintaan", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))

    await apiGet("/store")

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" })
  })

  it("mengembalikan undefined untuk 204 tanpa isi", async () => {
    stubFetch(new Response(null, { status: 204 }))

    await expect(apiDelete("/products/1")).resolves.toBeUndefined()
  })

  it("menyertakan Idempotency-Key ketika diberikan", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))

    await apiPost("/transactions", { items: [] }, { idempotencyKey: "kunci-1" })

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get("Idempotency-Key")).toBe("kunci-1")
  })

  it("tidak menyertakan header itu untuk permintaan biasa", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))

    await apiPost("/printers/test")

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.has("Idempotency-Key")).toBe(false)
  })

  /**
   * `undefined` has to disappear rather than be sent as the text "undefined",
   * which serde would read as a filter nobody asked for. An empty string stays:
   * every endpoint here treats it as "no filter", and that is a real answer.
   */
  it("membuang parameter undefined dan null, menyimpan string kosong", () => {
    expect(buildQueryString({ query: "", page: 1, category_id: undefined, sort_by: null })).toBe(
      "?query=&page=1",
    )
    expect(buildQueryString()).toBe("")
    expect(buildQueryString({})).toBe("")
  })

  it("menaruh path relatif di bawah /api supaya tetap same-origin", async () => {
    const fetchMock = stubFetch(new Response("[]", { status: 200 }))

    await apiGet("/products", { per_page: 50 })

    expect(fetchMock.mock.calls[0][0]).toBe("/api/products?per_page=50")
  })
})

describe("kunci idempotensi", () => {
  it("membuat kunci unik yang cukup panjang untuk diterima server", () => {
    const keys = new Set(Array.from({ length: 100 }, () => createIdempotencyKey()))

    expect(keys.size).toBe(100)
    for (const key of keys) {
      expect(key.length).toBeGreaterThanOrEqual(8)
      expect(key.length).toBeLessThanOrEqual(200)
    }
  })

  /** Plain HTTP on the shop LAN is not a secure context, so this path is real. */
  it("tetap membuat kunci tanpa crypto.randomUUID", () => {
    const original = globalThis.crypto
    vi.stubGlobal("crypto", {})

    try {
      const key = createIdempotencyKey()
      expect(key.length).toBeGreaterThanOrEqual(8)
      expect(createIdempotencyKey()).not.toBe(key)
    } finally {
      vi.stubGlobal("crypto", original)
    }
  })
})
