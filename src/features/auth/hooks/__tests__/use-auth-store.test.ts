import { beforeEach, describe, expect, it } from "vitest"

import { handleSessionExpired, useAuthStore } from "../use-auth-store"
import type { User } from "../../types"

/**
 * The store stopped being the identity and became a cache of it.
 *
 * The tests it used to have were about a client-side session: an eight-hour
 * timeout, a `lastActivity` stamp, a `checkTimeout` that logged the user out.
 * All three are gone, and not because they were wrong — because the server owns
 * session expiry now, with a sliding deadline set by
 * `security.session_timeout_minutes`. A second timer here could only disagree
 * with it, and the one that disagreed would be this one.
 *
 * What is left to test is what the route guard reads: the cached user appears,
 * disappears, and never comes back on its own.
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: "admin",
    full_name: "Admin Toko",
    role: "admin",
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  }
}

function store() {
  return useAuthStore.getState()
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isResolved: false })
})

describe("setUser", () => {
  it("menyimpan pengguna yang dijawab /auth/me", () => {
    const user = makeUser()

    store().setUser(user)

    expect(store().user).toEqual(user)
    expect(store().isAuthenticated()).toBe(true)
  })

  it("menandai sesi sudah terjawab meskipun jawabannya kosong", () => {
    expect(store().isResolved).toBe(false)

    store().setUser(null)

    expect(store().user).toBeNull()
    expect(store().isResolved).toBe(true)
    expect(store().isAuthenticated()).toBe(false)
  })

  it("mengganti pengguna sebelumnya saat kasir lain login di terminal yang sama", () => {
    store().setUser(makeUser())

    store().setUser(makeUser({ id: 2, username: "kasir01", role: "kasir" }))

    expect(store().user).toMatchObject({ id: 2, role: "kasir" })
  })
})

describe("clearUser", () => {
  it("mengosongkan cache tanpa menunggu jawaban baru", () => {
    store().setUser(makeUser())

    store().clearUser()

    expect(store().user).toBeNull()
    expect(store().isAuthenticated()).toBe(false)
    expect(store().isResolved).toBe(true)
  })
})

describe("handleSessionExpired", () => {
  it("mengosongkan pengguna saat ada 401 di tengah pemakaian", () => {
    store().setUser(makeUser())

    handleSessionExpired()

    expect(store().user).toBeNull()
  })

  /**
   * The guard renders the login screen the moment the user goes away, so this
   * runs for every request that 401s at once. Doing nothing when there is
   * already nobody is what keeps a burst of failures from becoming a burst of
   * state updates on a screen that has already moved on.
   */
  it("tidak berbuat apa-apa ketika memang belum ada yang login", () => {
    store().setUser(null)
    const before = useAuthStore.getState()

    handleSessionExpired()

    expect(useAuthStore.getState()).toBe(before)
  })
})

describe("identitas tidak lagi disimpan di localStorage", () => {
  /**
   * The whole point of the change. The store used to persist the `User`,
   * including `role`, so anyone at the till could open devtools, write
   * `"admin"`, and every route guard and hidden button believed it.
   */
  it("tidak menulis apa pun ke localStorage saat pengguna diset", () => {
    localStorage.clear()

    store().setUser(makeUser())

    expect(localStorage.getItem("kasir-auth")).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})
