import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiDownload, apiGet, apiPost, apiUpload } from "../client"

function stubFetch(response: Response | Error | DOMException) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (!(response instanceof Response)) throw response
    return response
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("Permintaan berhasil, padahal seharusnya gagal")
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("errors without the documented body", () => {
  it("names a conflict and a validation failure from the status alone", async () => {
    stubFetch(new Response("<html>", { status: 409 }))
    expect((await failureOf(apiGet("/x"))).code).toBe("conflict")

    stubFetch(new Response("", { status: 422 }))
    expect((await failureOf(apiGet("/x"))).code).toBe("validation")
  })

  it("explains an upload that is too large", async () => {
    stubFetch(new Response("Payload Too Large", { status: 413 }))
    const error = await failureOf(apiUpload("/settings/store/logo", new Blob(["x"])))
    expect(error.code).toBe("bad_request")
    expect(error.message).toBe("Berkas terlalu besar untuk diunggah.")
  })

  it("treats a body with the wrong field types as no body", async () => {
    stubFetch(
      new Response(JSON.stringify({ code: 7, message: null }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const error = await failureOf(apiGet("/x"))
    expect(error.code).toBe("internal")
    expect(error.status).toBe(503)
  })

  it("ignores a Retry-After written as a date", async () => {
    stubFetch(
      new Response(JSON.stringify({ code: "rate_limited", message: "Tunggu" }), {
        status: 429,
        headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
      }),
    )
    const error = await failureOf(apiPost("/auth/login", {}))
    expect(error.code).toBe("rate_limited")
    expect(error.retryAfterSeconds).toBeNull()
  })
})

describe("successful bodies", () => {
  it("returns undefined for an empty 200 body", async () => {
    stubFetch(new Response("", { status: 200 }))
    await expect(apiPost("/x")).resolves.toBeUndefined()
  })

  it("sends no body and no JSON content type when there is nothing to send", async () => {
    const mock = stubFetch(new Response(null, { status: 204 }))
    await apiPost("/x")
    const init = mock.mock.calls[0][1]
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull()
  })

  it("keeps a falsy JSON body instead of dropping it", async () => {
    const mock = stubFetch(new Response(null, { status: 204 }))
    await apiPost("/x", 0)
    expect(mock.mock.calls[0][1]?.body).toBe("0")
  })
})

describe("aborted requests", () => {
  it("passes an abort through untouched instead of calling it a network failure", async () => {
    stubFetch(new DOMException("The operation was aborted.", "AbortError"))
    await expect(apiGet("/x")).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("apiDownload", () => {
  function stubObjectUrls() {
    const create = vi.fn(() => "blob:mock")
    const revoke = vi.fn()
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    return { create, revoke }
  }

  it("saves under the name the server suggested", async () => {
    stubObjectUrls()
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    stubFetch(
      new Response("a,b", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="template produk.csv"' },
      }),
    )

    await expect(apiDownload("/products/import-template", "template.csv")).resolves.toBe(
      "template produk.csv",
    )
    expect(click).toHaveBeenCalledOnce()
  })

  it("reads an unquoted filename", async () => {
    stubObjectUrls()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    stubFetch(
      new Response("a", {
        status: 200,
        headers: { "Content-Disposition": "attachment; filename=backup.db; size=1" },
      }),
    )

    await expect(apiDownload("/backups/x", "fallback.db")).resolves.toBe("backup.db")
  })

  it("falls back to the caller's name when the server sent none", async () => {
    stubObjectUrls()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    stubFetch(new Response("a", { status: 200 }))

    await expect(apiDownload("/backups/x", "fallback.db")).resolves.toBe("fallback.db")
  })

  it("surfaces a failed download as an ApiError instead of saving the error page", async () => {
    const { create } = stubObjectUrls()
    stubFetch(
      new Response(JSON.stringify({ code: "forbidden", message: "Khusus admin" }), {
        status: 403,
      }),
    )

    const error = await failureOf(apiDownload("/backups/x", "fallback.db"))
    expect(error).toMatchObject({ code: "forbidden", message: "Khusus admin" })
    expect(create).not.toHaveBeenCalled()
  })
})
