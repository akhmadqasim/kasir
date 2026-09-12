import { describe, expect, it, vi } from "vitest"

import { HEALTH_PATH, probeServer } from "../api/health"
import {
  DEFAULT_SERVER_PORT,
  isIpv4,
  normalizeServerOrigin,
  originAuthority,
  probeHosts,
  subnetHosts,
  subnetLabel,
} from "../net/lan"

describe("subnetHosts", () => {
  it("lists the /24 without the phone's own address", () => {
    const hosts = subnetHosts("192.168.1.37")
    expect(hosts).toHaveLength(253)
    expect(hosts[0]).toBe("192.168.1.1")
    expect(hosts.at(-1)).toBe("192.168.1.254")
    expect(hosts).not.toContain("192.168.1.37")
  })

  it("scans nothing when there is no usable address", () => {
    expect(subnetHosts("0.0.0.0")).toEqual([])
    expect(subnetHosts("127.0.0.1")).toEqual([])
    expect(subnetHosts("not-an-ip")).toEqual([])
    expect(subnetHosts("300.1.1.1")).toEqual([])
  })
})

describe("subnetLabel", () => {
  it("names the /24 being swept", () => {
    expect(subnetLabel("192.168.1.37")).toBe("192.168.1.0/24")
    expect(subnetLabel("10.0.0.5")).toBe("10.0.0.0/24")
  })

  it("has no label where there is nothing to scan", () => {
    expect(subnetLabel("0.0.0.0")).toBeNull()
    expect(subnetLabel("127.0.0.1")).toBeNull()
    expect(subnetLabel("not-an-ip")).toBeNull()
  })
})

describe("isIpv4", () => {
  it("accepts dotted quads within range only", () => {
    expect(isIpv4("10.0.0.1")).toBe(true)
    expect(isIpv4("256.0.0.1")).toBe(false)
    expect(isIpv4("kasir.lokal")).toBe(false)
  })
})

describe("normalizeServerOrigin", () => {
  it("fills in the scheme and the default port", () => {
    expect(normalizeServerOrigin("192.168.1.10")).toBe(`http://192.168.1.10:${DEFAULT_SERVER_PORT}`)
    expect(normalizeServerOrigin(" 192.168.1.10:17721 ")).toBe("http://192.168.1.10:17721")
    expect(normalizeServerOrigin("kasir.lokal")).toBe(`http://kasir.lokal:${DEFAULT_SERVER_PORT}`)
  })

  it("drops paths and keeps an explicit scheme", () => {
    expect(normalizeServerOrigin("http://192.168.1.10:17720/api/")).toBe(
      "http://192.168.1.10:17720",
    )
    expect(normalizeServerOrigin("https://kasir.lokal")).toBe("https://kasir.lokal:443")
  })

  it("rejects what cannot be a server address", () => {
    expect(normalizeServerOrigin("")).toBeNull()
    expect(normalizeServerOrigin("ftp://x")).toBeNull()
    expect(normalizeServerOrigin("http://user:pw@host")).toBeNull()
    expect(normalizeServerOrigin("http://")).toBeNull()
  })

  it("round-trips through originAuthority", () => {
    expect(originAuthority("http://192.168.1.10:17720")).toBe("192.168.1.10:17720")
  })
})

describe("probeServer", () => {
  it("recognises the onboarding status boolean as a kasir server", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response("false", { status: 200 }))
    const result = await probeServer("http://10.0.0.2:17720", { fetch })

    expect(fetch.mock.calls[0]?.[0]).toBe(`http://10.0.0.2:17720${HEALTH_PATH}`)
    expect(result).toEqual({ origin: "http://10.0.0.2:17720", ok: true, onboardingPending: false })
  })

  it("does not mistake any 200 for a kasir server", async () => {
    const fetch = vi.fn(async () => new Response("<html>router</html>", { status: 200 }))
    expect((await probeServer("http://10.0.0.1:17720", { fetch })).ok).toBe(false)
  })

  it("treats a thrown fetch as a miss rather than an error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Network request failed")
    })
    expect((await probeServer("http://10.0.0.9:17720", { fetch })).ok).toBe(false)
  })

  it("gives up after the timeout", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          )
        }),
    )
    const started = Date.now()
    const result = await probeServer("http://10.0.0.3:17720", { fetch, timeoutMs: 20 })
    expect(result.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe("probeHosts", () => {
  it("probes every host with bounded concurrency and reports the hits", async () => {
    let inFlight = 0
    let peak = 0
    const fetch = vi.fn(async (url: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return url.startsWith("http://10.0.0.7:")
        ? new Response("false", { status: 200 })
        : new Response("", { status: 404 })
    })

    const progress: number[] = []
    const found = await probeHosts(
      Array.from({ length: 20 }, (_, index) => `10.0.0.${index + 1}`),
      { fetch, port: 17720, concurrency: 4, onProgress: (done) => progress.push(done) },
    )

    expect(fetch).toHaveBeenCalledTimes(20)
    expect(peak).toBeLessThanOrEqual(4)
    expect(found.map((result) => result.origin)).toEqual(["http://10.0.0.7:17720"])
    expect(progress.at(-1)).toBe(20)
  })

  it("stops early when aborted", async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => {
      controller.abort()
      return new Response("", { status: 404 })
    })

    await probeHosts(["10.0.0.1", "10.0.0.2", "10.0.0.3"], {
      fetch,
      concurrency: 1,
      signal: controller.signal,
    })

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
