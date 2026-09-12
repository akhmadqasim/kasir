import type { FetchLike } from "./client"

/**
 * "Is there a kasir server at this address?"
 *
 * The server has no `/api/health` yet (listed under backend gaps in
 * `apps/mobile/README.md`). The closest thing is `GET /api/onboarding/status`:
 * public — it has to answer before any account exists — cheap, and it returns
 * a bare JSON boolean, which is distinctive enough to tell a kasir server from
 * a router's admin page answering 200 to everything.
 */
export const HEALTH_PATH = "/api/onboarding/status"

export interface ProbeOptions {
  fetch?: FetchLike
  /** How long to wait for one host before giving up. */
  timeoutMs?: number
  signal?: AbortSignal
}

/** What a probe learned about one origin. */
export interface ProbeResult {
  origin: string
  /** `true` when the answer was recognisably a kasir server. */
  ok: boolean
  /** The server still needs first-run setup; `null` when unknown. */
  onboardingPending: boolean | null
}

/**
 * Probe one origin (`http://host:port`). Never throws: an unreachable host is
 * an ordinary answer during a subnet scan, not an exception.
 */
export async function probeServer(origin: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 600)
  const onOuterAbort = () => controller.abort()
  options.signal?.addEventListener("abort", onOuterAbort, { once: true })

  try {
    const response = await fetchImpl(`${origin}${HEALTH_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) return { origin, ok: false, onboardingPending: null }

    const text = (await response.text()).trim()
    if (text !== "true" && text !== "false") return { origin, ok: false, onboardingPending: null }

    return { origin, ok: true, onboardingPending: text === "true" }
  } catch {
    return { origin, ok: false, onboardingPending: null }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onOuterAbort)
  }
}
