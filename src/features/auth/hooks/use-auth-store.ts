import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useEffect, useState } from "react"
import type { User } from "../types"

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours
const HYDRATION_TIMEOUT_MS = 5_000

interface AuthState {
  user: User | null
  lastActivity: number
  login: (user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
  updateActivity: () => void
  checkTimeout: (timeoutMs?: number) => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      lastActivity: Date.now(),
      login: (user) => set({ user, lastActivity: Date.now() }),
      logout: () => set({ user: null, lastActivity: 0 }),
      isAuthenticated: () => get().user !== null,
      updateActivity: () => set({ lastActivity: Date.now() }),
      checkTimeout: (timeoutMs = SESSION_TIMEOUT_MS) => {
        const elapsed = Date.now() - get().lastActivity
        if (elapsed > timeoutMs) {
          set({ user: null, lastActivity: 0 })
          return true
        }
        return false
      },
    }),
    {
      name: "kasir-auth",
      partialize: (state) => ({
        user: state.user,
        lastActivity: state.lastActivity,
      }),
    }
  )
)

export function useAuthHydrated() {
  const [hydrated, setHydrated] = useState(useAuthStore.persist.hasHydrated())

  useEffect(() => {
    if (hydrated) return

    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true)
    })

    // Re-check: hydration may have completed between useState init and this effect
    if (useAuthStore.persist.hasHydrated()) {
      unsub()
      queueMicrotask(() => setHydrated(true))
      return
    }

    // Safety timeout: if hydration never completes, clear stored state and proceed
    const timeout = setTimeout(() => {
      if (!useAuthStore.persist.hasHydrated()) {
        console.error("[AUTH] Hydration timeout — clearing stored auth state")
        try {
          localStorage.removeItem("kasir-auth")
        } catch { /* storage may be inaccessible */ }
        setHydrated(true)
      }
    }, HYDRATION_TIMEOUT_MS)

    return () => {
      unsub()
      clearTimeout(timeout)
    }
  }, [hydrated])

  return hydrated
}
