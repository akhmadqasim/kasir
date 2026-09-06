import { create } from "zustand"
import type { User } from "../types"

/**
 * A display cache for the logged-in account. Not the identity.
 *
 * The identity is the `HttpOnly` session cookie, which this code cannot read
 * and does not need to. What lives here is the answer `GET /api/auth/me` gave,
 * kept so that a sidebar can print a name and a screen can hide an admin button
 * without every one of them issuing its own request.
 *
 * Two things it deliberately no longer does:
 *
 * **It does not persist.** The store used to write the whole `User` — id, name
 * and `role` — to `localStorage`. Anyone at the till could open devtools, set
 * `role` to `"admin"`, and every route guard and every hidden button believed
 * it. The guards were the only thing that check was protecting, because the
 * commands took the caller's id from the request body and believed that too.
 * Now the server decides both, and a tampered cache buys nothing: the screen
 * would render and every request behind it would come back 403.
 *
 * **It does not track a timeout.** Session expiry is the server's, sliding with
 * activity, configured by `security.session_timeout_minutes`. A second timer
 * here could only disagree with it.
 */
interface AuthState {
  /** `null` before the boot request has answered, and after the session ends. */
  user: User | null
  /** True once `/auth/me` has answered, whichever way it answered. */
  isResolved: boolean
  setUser: (user: User | null) => void
  clearUser: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isResolved: false,
  setUser: (user) => set({ user, isResolved: true }),
  clearUser: () => set({ user: null, isResolved: true }),
  isAuthenticated: () => get().user !== null,
}))

/**
 * What the API client calls when a request comes back 401.
 *
 * Dropping the cached user is the whole of it. The route guard watches that
 * value and shows the login screen when it goes away, so the redirect happens
 * through the router rather than through a `window.location` assignment. That
 * is what keeps it from looping: the login screen issues no authenticated
 * request, so there is nothing left to answer 401 and bounce again.
 */
export function handleSessionExpired(): void {
  if (useAuthStore.getState().user === null) return
  useAuthStore.getState().clearUser()
}
