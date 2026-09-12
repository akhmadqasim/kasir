import type { ChangeOwnPinInput, LoginInput, User } from "../types/auth"
import type { ApiClient } from "./client"

/**
 * The requests that deal in the session itself.
 *
 * `login` and `me` opt out of the global 401 handler. A 401 from `login` means
 * the PIN was wrong and the user is already looking at the login screen; a 401
 * from `me` at boot means nobody is logged in yet, which is the ordinary first
 * run of the day. Letting either one trigger the "your session expired" path
 * would put the app in a loop between the guard and the login form.
 */
export function createAuthApi(client: ApiClient) {
  return {
    login(input: LoginInput): Promise<User> {
      return client.post<User>("/auth/login", input, { handleUnauthorized: false })
    },

    logout(): Promise<void> {
      return client.post<void>("/auth/logout")
    },

    /** The account behind the current cookie. Throws `ApiError("auth")` when there is none. */
    getCurrentUser(): Promise<User> {
      return client.get<User>("/auth/me", undefined, { handleUnauthorized: false })
    },

    /** Change the PIN of whoever is logged in. The session says who that is. */
    changeOwnPin(input: ChangeOwnPinInput): Promise<void> {
      return client.put<void>("/auth/me/pin", input)
    },
  }
}

export type AuthApi = ReturnType<typeof createAuthApi>
