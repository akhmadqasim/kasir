import { create } from "zustand"
import type { User } from "../types"

interface AuthState {
  user: User | null
  lastActivity: number
  login: (user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
  updateActivity: () => void
  checkTimeout: (timeoutMs?: number) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  lastActivity: Date.now(),
  login: (user) => set({ user, lastActivity: Date.now() }),
  logout: () => set({ user: null }),
  isAuthenticated: () => get().user !== null,
  updateActivity: () => set({ lastActivity: Date.now() }),
  checkTimeout: (timeoutMs = 30 * 60 * 1000) => {
    const elapsed = Date.now() - get().lastActivity
    if (elapsed > timeoutMs) {
      set({ user: null })
      return true
    }
    return false
  },
}))
