import { describe, expect, it, vi } from "vitest"

import type { ApiClient } from "../client"
import { createStoreApi, publicStoreLogoUrl } from "../store"

describe("storeApi.getPublicStoreInfo", () => {
  it("reads the public slice without triggering the session-expired handler", async () => {
    const get = vi.fn(async () => ({ name: "Toko Jaya", has_logo: true }))
    const api = createStoreApi({ get } as unknown as ApiClient)

    await expect(api.getPublicStoreInfo()).resolves.toEqual({ name: "Toko Jaya", has_logo: true })
    // A 401 here would mean "nobody signed in", which is exactly where the login
    // screen already is — it must not bounce back to itself.
    expect(get).toHaveBeenCalledWith("/store/public", undefined, { handleUnauthorized: false })
  })
})

describe("publicStoreLogoUrl", () => {
  it("is null when the store has no logo or is not set up yet", () => {
    expect(publicStoreLogoUrl("http://10.0.0.2:17720/api", null, 1)).toBeNull()
    expect(publicStoreLogoUrl("http://10.0.0.2:17720/api", undefined, 1)).toBeNull()
    expect(
      publicStoreLogoUrl("http://10.0.0.2:17720/api", { name: "Toko", has_logo: false }, 1),
    ).toBeNull()
  })

  it("points at the logo endpoint with a cache-busting version", () => {
    expect(
      publicStoreLogoUrl("http://10.0.0.2:17720/api", { name: "Toko", has_logo: true }, 1700),
    ).toBe("http://10.0.0.2:17720/api/store/logo?v=1700")
  })

  it("does not double the slash when the base ends with one", () => {
    expect(
      publicStoreLogoUrl("http://10.0.0.2:17720/api/", { name: "Toko", has_logo: true }, "a b"),
    ).toBe("http://10.0.0.2:17720/api/store/logo?v=a%20b")
  })
})
