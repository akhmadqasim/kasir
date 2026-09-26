import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"

/**
 * Whether stepping back stays inside the app.
 *
 * The first entry of a router session has the key `"default"`. That alone
 * misses one case: the resume redirect on `/` replaces the entry with a new key
 * but no earlier page. `createBrowserRouter` records each entry's position as
 * `history.state.idx`, so position 0 means there is nothing of ours behind it.
 * A memory router (tests) leaves `history.state` alone and falls back to the key.
 */
function hasInAppHistory(locationKey: string): boolean {
  if (locationKey === "default") return false
  const state: unknown = window.history.state
  if (typeof state === "object" && state !== null && "idx" in state) {
    const { idx } = state
    if (typeof idx === "number") return idx > 0
  }
  return true
}

/**
 * Go back one page, or to `fallback` when this page was opened directly.
 *
 * A bare `navigate(-1)` on a page opened straight from its address (a restored
 * session, a typed URL) steps out of the app — or, in the desktop window,
 * does nothing at all and leaves the cashier stuck.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  const { key } = useLocation()
  return useCallback(() => {
    if (hasInAppHistory(key)) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [fallback, key, navigate])
}
