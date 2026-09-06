import type { LoginInput, User } from "@/features/auth/types"
import { apiGet, apiPost, apiPut } from "./client"

/**
 * The three requests that deal in the session itself.
 *
 * `login` and `me` opt out of the global 401 handler. A 401 from `login` means
 * the PIN was wrong and the user is already looking at the login screen; a 401
 * from `me` at boot means nobody is logged in yet, which is the ordinary first
 * run of the day. Letting either one trigger the "your session expired" path
 * would put the app in a loop between the guard and the login form.
 */

export function login(input: LoginInput): Promise<User> {
  return apiPost<User>("/auth/login", input, { handleUnauthorized: false })
}

export function logout(): Promise<void> {
  return apiPost<void>("/auth/logout")
}

/** The account behind the current cookie. Throws `ApiError("auth")` when there is none. */
export function getCurrentUser(): Promise<User> {
  return apiGet<User>("/auth/me", undefined, { handleUnauthorized: false })
}

export interface ChangeOwnPinInput {
  currentPin: string
  newPin: string
}

/**
 * Change the PIN of whoever is logged in.
 *
 * There is no user id: the session says who this is. The old command took one
 * from the caller and trusted it.
 */
export function changeOwnPin(input: ChangeOwnPinInput): Promise<void> {
  return apiPut<void>("/auth/me/pin", input)
}
