import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/startup-logger", () => ({ setLogSessionActive: vi.fn() }))

import { setLogSessionActive } from "@/lib/startup-logger"
import type { User } from "../types"
import { handleSessionExpired, useAuthStore } from "./use-auth-store"

const user: User = {
  id: 1,
  username: "admin",
  full_name: "Admin",
  role: "admin",
  is_active: true,
  created_at: "",
  updated_at: "",
}

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isResolved: false })
    vi.mocked(setLogSessionActive).mockClear()
  })

  it("starts unresolved with no user", () => {
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isResolved).toBe(false)
  })

  it("setUser stores the user and resolves", () => {
    useAuthStore.getState().setUser(user)
    expect(useAuthStore.getState().user).toEqual(user)
    expect(useAuthStore.getState().isResolved).toBe(true)
    expect(setLogSessionActive).toHaveBeenCalledWith(true)
  })

  it("clearUser resolves without a user", () => {
    useAuthStore.getState().clearUser()
    expect(useAuthStore.getState().isResolved).toBe(true)
    expect(setLogSessionActive).not.toHaveBeenCalled()
  })

  it("handleSessionExpired clears an active user", () => {
    useAuthStore.getState().setUser(user)
    handleSessionExpired()
    expect(useAuthStore.getState().user).toBeNull()
    expect(setLogSessionActive).toHaveBeenLastCalledWith(false)
  })

  it("handleSessionExpired is a no-op without a user", () => {
    handleSessionExpired()
    expect(useAuthStore.getState().isResolved).toBe(false)
  })
})
