import { probeServer, type ProbeOptions, type ProbeResult } from "../api/health"

/**
 * Finding the desktop POS on the shop Wi-Fi without any native module.
 *
 * The phone knows its own IPv4 address (via `expo-network`) but not the subnet
 * mask, so the scan assumes a /24 — what every consumer router hands out — and
 * knocks on every host in it. That is 253 HTTP requests, run a few dozen at a
 * time with a short timeout; on a quiet LAN it finishes in a few seconds.
 *
 * mDNS (`_kasir._tcp`) would be the proper answer and is listed under backend
 * gaps in `apps/mobile/README.md`; it needs a native module on the phone and a
 * responder in the Rust server, neither of which Expo Go can load.
 */

/** The desktop's default HTTP port (`DEFAULT_PORT` in `src-tauri/src/http/mod.rs`). */
export const DEFAULT_SERVER_PORT = 17720

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isIpv4(value: string): boolean {
  const match = IPV4.exec(value.trim())
  if (!match) return false
  return match.slice(1).every((octet) => Number(octet) <= 255)
}

/**
 * `192.168.1.0/24` → every usable host except the phone itself.
 *
 * Returns an empty list for the addresses `expo-network` uses to say "no
 * address" (`0.0.0.0`) and for loopback, so a scan on a disconnected phone
 * does nothing rather than hammering nothing.
 */
export function subnetHosts(ownIp: string): string[] {
  const match = IPV4.exec(ownIp.trim())
  if (!match) return []
  const [a, b, c, d] = match.slice(1).map(Number)
  if ([a, b, c, d].some((octet) => octet > 255)) return []
  if (a === 0 || a === 127) return []

  const hosts: string[] = []
  for (let host = 1; host <= 254; host += 1) {
    if (host === d) continue
    hosts.push(`${a}.${b}.${c}.${host}`)
  }
  return hosts
}

export interface DiscoverOptions extends ProbeOptions {
  port?: number
  /** How many probes are in flight at once. */
  concurrency?: number
  /** Called after every host, hit or miss, so a screen can draw progress. */
  onProgress?: (done: number, total: number) => void
  /** Called as soon as a server answers, before the whole scan finishes. */
  onFound?: (result: ProbeResult) => void
}

/**
 * Probe every host in the phone's /24 for a kasir server on `port`. Resolves
 * with the servers that answered, in the order they were found.
 */
export async function discoverServers(
  ownIp: string,
  options: DiscoverOptions = {},
): Promise<ProbeResult[]> {
  const hosts = subnetHosts(ownIp)
  return probeHosts(hosts, options)
}

/** The scan itself, separated from the address arithmetic so it can be tested with a fake fetch. */
export async function probeHosts(
  hosts: readonly string[],
  options: DiscoverOptions = {},
): Promise<ProbeResult[]> {
  const port = options.port ?? DEFAULT_SERVER_PORT
  const concurrency = Math.max(1, options.concurrency ?? 32)
  const found: ProbeResult[] = []
  let next = 0
  let done = 0

  async function worker(): Promise<void> {
    while (next < hosts.length && !options.signal?.aborted) {
      const host = hosts[next]
      next += 1
      const result = await probeServer(`http://${host}:${port}`, options)
      done += 1
      if (result.ok) {
        found.push(result)
        options.onFound?.(result)
      }
      options.onProgress?.(done, hosts.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker))
  return found
}

/**
 * Turn what a user typed into an origin the client can use, or `null`.
 *
 * Accepts `192.168.1.10`, `192.168.1.10:17720`, `http://kasir.lokal:17720/`,
 * and a hostname. A missing port gets {@link DEFAULT_SERVER_PORT}; a scheme
 * other than `http`/`https` is rejected; paths and query strings are dropped,
 * because the API prefix is added by the client.
 */
export function normalizeServerOrigin(input: string): string | null {
  let value = input.trim()
  if (!value) return null

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!url.hostname) return null
  if (url.username || url.password) return null

  const port = url.port || (url.protocol === "https:" ? "443" : String(DEFAULT_SERVER_PORT))
  return `${url.protocol}//${url.hostname}:${port}`
}

/** `http://host:port` → `host:port`, for display and for the `Origin` header comparison. */
export function originAuthority(origin: string): string {
  return origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "")
}
