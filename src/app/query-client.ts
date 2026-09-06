import { QueryClient } from "@tanstack/react-query"

import { handleSessionExpired } from "@/features/auth/hooks/use-auth-store"
import { isApiError, setUnauthorizedHandler } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * The application's one query cache, and the session handling that needs it.
 *
 * Its own module rather than part of `providers.tsx` for two reasons: a file
 * that exports both a component and a constant defeats Fast Refresh, and the
 * 401 handler below is not a React concern at all — it runs for requests made
 * from Zustand stores and event handlers as readily as from a hook.
 */

/**
 * Retrying a failed read is only worth it when the failure might not happen
 * again. A 401, a 403 or a 422 will happen again, identically, and retrying
 * costs the user a second of spinner before the same message. Only a dropped
 * connection and a server-side fault are worth one more go.
 */
export const queryClient = new QueryClient({
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
    // Mutations are never retried, and that default is not worth changing:
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
