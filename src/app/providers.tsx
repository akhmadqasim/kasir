import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { handleSessionExpired } from "@/features/auth/hooks/use-auth-store"
import { isApiError, setUnauthorizedHandler } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * Retrying a failed read is only ever worth it when the failure might not
 * happen again. A 401, a 403 or a 422 will happen again, identically, and
 * retrying them costs the user a second of spinner before the same message.
 * Only a dropped connection and a server-side fault are worth one more go.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false
        if (!isApiError(error)) return true
        return error.code === "network" || error.code === "internal"
      },
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    // Mutations are never retried, and that is not a default worth changing:
    // three of them move money, and the `Idempotency-Key` exists precisely so
    // that a retry is a decision somebody makes, not one a library makes.
  },
})

/**
 * What happens when any request comes back 401.
 *
 * Registered once, here, because this is where the cache lives. Both halves
 * matter: the store is what the route guard reads, and the cached `/auth/me`
 * answer is what would otherwise put the old user straight back the next time
 * the guard mounted.
 *
 * Nothing navigates. The guard sees the user go away and renders the login
 * screen itself, which is what makes a loop impossible — a redirect issued from
 * here would fire again for every in-flight request that 401s alongside the
 * first one.
 */
setUnauthorizedHandler(() => {
  handleSessionExpired()
  queryClient.setQueryData(queryKeys.auth.me, null)
})

/**
 * React Query is the only provider left. HeroUI needs none — the theme travels
 * on `<html>` as a `light`/`dark` class plus `data-theme`, and its `Tooltip`
 * carries its own context per instance, so the Radix `TooltipProvider` that used
 * to wrap the app went away with the last Radix tooltip.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
