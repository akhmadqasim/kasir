import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { useAuthStore } from "../use-auth-store"
import type { User } from "../../types"

// ── Helpers ──────────────────────────────────────────────────────────

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

// ── Reset store between tests ────────────────────────────────────────

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    lastActivity: Date.now(),
  })
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// =====================================================================
// login
// =====================================================================

describe("login", () => {
  it("sets user on login", () => {
    const user = makeUser()
    store().login(user)

    expect(store().user).toEqual(user)
  })

  it("sets isAuthenticated to true after login", () => {
    store().login(makeUser())
    expect(store().isAuthenticated()).toBe(true)
  })

  it("updates lastActivity on login", () => {
    const before = Date.now()
    store().login(makeUser())
    const after = Date.now()

    expect(store().lastActivity).toBeGreaterThanOrEqual(before)
    expect(store().lastActivity).toBeLessThanOrEqual(after)
  })

  it("stores admin user with correct role", () => {
    store().login(makeUser({ role: "admin" }))
    expect(store().user?.role).toBe("admin")
  })

  it("stores kasir user with correct role", () => {
    store().login(makeUser({ role: "kasir", username: "kasir1" }))
    expect(store().user?.role).toBe("kasir")
    expect(store().user?.username).toBe("kasir1")
  })

  it("replaces previous user on re-login", () => {
    store().login(makeUser({ id: 1, username: "user1" }))
    store().login(makeUser({ id: 2, username: "user2" }))

    expect(store().user?.id).toBe(2)
    expect(store().user?.username).toBe("user2")
  })
})

// =====================================================================
// logout
// =====================================================================

describe("logout", () => {
  it("clears user on logout", () => {
    store().login(makeUser())
    store().logout()

    expect(store().user).toBeNull()
  })

  it("sets isAuthenticated to false after logout", () => {
    store().login(makeUser())
    store().logout()

    expect(store().isAuthenticated()).toBe(false)
  })

  it("resets lastActivity to 0 on logout", () => {
    store().login(makeUser())
    store().logout()

    expect(store().lastActivity).toBe(0)
  })

  it("is idempotent — logging out twice doesn't error", () => {
    store().logout()
    store().logout()
    expect(store().user).toBeNull()
    expect(store().isAuthenticated()).toBe(false)
  })
})

// =====================================================================
// isAuthenticated
// =====================================================================

describe("isAuthenticated", () => {
  it("returns false when no user is logged in", () => {
    expect(store().isAuthenticated()).toBe(false)
  })

  it("returns true when user is logged in", () => {
    store().login(makeUser())
    expect(store().isAuthenticated()).toBe(true)
  })

  it("returns false after logout", () => {
    store().login(makeUser())
    store().logout()
    expect(store().isAuthenticated()).toBe(false)
  })
})

// =====================================================================
// updateActivity
// =====================================================================

describe("updateActivity", () => {
  it("updates lastActivity timestamp", () => {
    const before = Date.now()
    store().updateActivity()
    const after = Date.now()

    expect(store().lastActivity).toBeGreaterThanOrEqual(before)
    expect(store().lastActivity).toBeLessThanOrEqual(after)
  })

  it("refreshes activity after some delay", () => {
    vi.useFakeTimers()
    const initialTime = Date.now()
    useAuthStore.setState({ lastActivity: initialTime })

    vi.advanceTimersByTime(5000)
    store().updateActivity()

    expect(store().lastActivity).toBeGreaterThan(initialTime)
  })
})

// =====================================================================
// checkTimeout
// =====================================================================

describe("checkTimeout", () => {
  it("returns false when session is fresh", () => {
    store().login(makeUser())
    expect(store().checkTimeout()).toBe(false)
    expect(store().user).not.toBeNull()
  })

  it("returns false when within timeout window", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    // Advance 7 hours (under 8-hour limit)
    vi.advanceTimersByTime(7 * 60 * 60 * 1000)

    expect(store().checkTimeout()).toBe(false)
    expect(store().user).not.toBeNull()
  })

  it("returns true and clears user when session has expired (8 hours)", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    // Advance past 8-hour limit
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1)

    expect(store().checkTimeout()).toBe(true)
    expect(store().user).toBeNull()
    expect(store().lastActivity).toBe(0)
  })

  it("returns true exactly at 8-hour boundary + 1ms", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1)
    expect(store().checkTimeout()).toBe(true)
  })

  it("returns false exactly at 8-hour boundary", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    // Exactly 8 hours — elapsed === timeout, not > timeout
    vi.advanceTimersByTime(8 * 60 * 60 * 1000)
    expect(store().checkTimeout()).toBe(false)
  })

  it("accepts custom timeout parameter", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    const customTimeout = 60 * 1000 // 1 minute
    vi.advanceTimersByTime(61 * 1000)

    expect(store().checkTimeout(customTimeout)).toBe(true)
    expect(store().user).toBeNull()
  })

  it("custom timeout — within window returns false", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    const customTimeout = 60 * 1000 // 1 minute
    vi.advanceTimersByTime(30 * 1000)

    expect(store().checkTimeout(customTimeout)).toBe(false)
    expect(store().user).not.toBeNull()
  })

  it("activity update resets the timeout window", () => {
    vi.useFakeTimers()
    store().login(makeUser())

    // Advance 7 hours
    vi.advanceTimersByTime(7 * 60 * 60 * 1000)
    store().updateActivity()

    // Advance another 7 hours (14 total, but only 7 since last activity)
    vi.advanceTimersByTime(7 * 60 * 60 * 1000)

    expect(store().checkTimeout()).toBe(false)
    expect(store().user).not.toBeNull()
  })
})

// =====================================================================
// Edge cases
// =====================================================================

describe("edge cases", () => {
  it("initial state has no user", () => {
    useAuthStore.setState({ user: null, lastActivity: 0 })
    expect(store().user).toBeNull()
    expect(store().isAuthenticated()).toBe(false)
  })

  it("login after logout works correctly", () => {
    const user = makeUser()
    store().login(user)
    store().logout()
    store().login(user)

    expect(store().user).toEqual(user)
    expect(store().isAuthenticated()).toBe(true)
  })

  it("checkTimeout on logged-out state with lastActivity=0", () => {
    vi.useFakeTimers()
    useAuthStore.setState({ user: null, lastActivity: 0 })

    // With lastActivity = 0, elapsed = Date.now() which is huge
    expect(store().checkTimeout()).toBe(true)
  })
})
