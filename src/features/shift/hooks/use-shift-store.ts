import { create } from "zustand"
import { persist } from "zustand/middleware"
import { invoke } from "@tauri-apps/api/core"
import type { Shift } from "../types"

interface ShiftState {
  activeShift: Shift | null
  isLoading: boolean
  setActiveShift: (shift: Shift | null) => void
  fetchActiveShift: (userId: number) => Promise<Shift | null>
  openShift: (userId: number, openingCash?: number) => Promise<Shift>
  clearShift: () => void
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set) => ({
      activeShift: null,
      isLoading: false,

      setActiveShift: (shift) => set({ activeShift: shift }),

      fetchActiveShift: async (userId: number) => {
        set({ isLoading: true })
        try {
          const shift = await invoke<Shift | null>("get_active_shift", {
            userId,
          })
          set({ activeShift: shift, isLoading: false })
          return shift
        } catch {
          // Keeping the persisted shift here would send checkout the id of a shift
          // that is already closed, and the sale would miss every shift report.
          set({ activeShift: null, isLoading: false })
          return null
        }
      },

      openShift: async (userId: number, openingCash?: number) => {
        const shift = await invoke<Shift>("open_shift", {
          input: { userId, openingCash },
        })
        set({ activeShift: shift })
        return shift
      },

      clearShift: () => set({ activeShift: null }),
    }),
    {
      name: "kasir-shift",
      // Bump when the persisted shape changes so old localStorage entries are dropped
      // instead of being rehydrated into a state the code no longer expects.
      version: 1,
      partialize: (state) => ({ activeShift: state.activeShift }),
    }
  )
)
