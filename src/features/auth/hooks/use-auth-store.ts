import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useEffect, useState } from "react"
import type { User } from "../types"

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000

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
      checkTimeout: (timeoutMs = SIX_MONTHS_MS) => {
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
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true)
    })
    return unsub
  }, [])

  return hydrated
}
