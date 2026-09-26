import { create } from "zustand"
import * as shiftsApi from "@/lib/api/shifts"
import type { Shift } from "../types"

/**
 * The open shift, held outside React because the cart needs it at checkout and
 * the cart is not a component either.
 *
 * Two things changed with HTTP. There is no `userId` to pass — the server
 * answers about the session's own shift — and the state is no longer persisted
 * to `localStorage`. A persisted shift was a hazard the moment two cashiers
 * share a till: the second one's browser would rehydrate the first one's open
 * shift and book sales against it. The answer comes from the server on every
 * boot, which is the only place it was ever correct.
 */

/**
 * Outcome of asking for a shift.
 *
 * `POST /shifts` returns the caller's existing open shift instead of erroring
 * when there already is one, so "the request succeeded" does not mean "a shift
 * was opened" — and the opening cash that was typed in is silently dropped. The
 * flag lets the dialog say which of the two actually happened.
 */
interface OpenShiftOutcome {
  shift: Shift
  alreadyOpen: boolean
}

interface ShiftState {
  activeShift: Shift | null
  fetchActiveShift: () => Promise<Shift | null>
  openShift: (openingCash?: number) => Promise<OpenShiftOutcome>
  clearShift: () => void
}

export const useShiftStore = create<ShiftState>()((set) => ({
  activeShift: null,

  fetchActiveShift: async () => {
    try {
      // `?? null`: an empty body reads as `undefined`, which every
      // `activeShift === null` check downstream would take for a shift.
      const shift = (await shiftsApi.getActiveShift()) ?? null
      set({ activeShift: shift })
      return shift
    } catch {
      // Keeping the last known shift here would show the cashier a shift that
      // may already be closed. (Checkout no longer sends a shift id: the server
      // books the sale to the cashier's own open shift.)
      set({ activeShift: null })
      return null
    }
  },

  openShift: async (openingCash?: number) => {
    // Ask first, so a shift that is already open is reported as such rather than
    // passed off as a fresh one with the entered opening cash applied.
    const existing = await shiftsApi.getActiveShift()
    if (existing) {
      set({ activeShift: existing })
      return { shift: existing, alreadyOpen: true }
    }

    const shift = await shiftsApi.openShift({ openingCash })
    set({ activeShift: shift })
    return { shift, alreadyOpen: false }
  },

  clearShift: () => set({ activeShift: null }),
}))
