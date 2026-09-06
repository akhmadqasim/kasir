import type { User } from "@/features/auth/types"
import type { CreateUserInput, UpdateUserInput } from "@/features/users/types"
import { apiGet, apiPatch, apiPost } from "./client"

/**
 * Staff accounts. Admin-only on the server; the screen is behind the same guard.
 *
 * The account being changed is named by the URL. The body types carry no id at
 * all, which is what stops a payload from aiming an update somewhere other than
 * where the URL points.
 */

export function listUsers(): Promise<User[]> {
  return apiGet<User[]>("/users")
}

export function createUser(input: CreateUserInput): Promise<User> {
  return apiPost<User>("/users", input)
}

export function updateUser(input: UpdateUserInput): Promise<User> {
  const { userId, ...body } = input
  return apiPatch<User>(`/users/${userId}`, body)
}

export function setUserActive(userId: number, isActive: boolean): Promise<User> {
  return apiPatch<User>(`/users/${userId}/active`, { isActive })
}
