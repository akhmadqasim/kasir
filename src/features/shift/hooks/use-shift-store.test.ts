import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Shift } from "../types"

vi.mock("@/lib/api/shifts", () => ({
  getActiveShift: vi.fn(),
  openShift: vi.fn(),
}))

import * as shiftsApi from "@/lib/api/shifts"
import { useShiftStore } from "./use-shift-store"

const SHIFT: Shift = {
  id: 9,
  userId: 2,
  userName: "Kasir Satu",
  openingCash: 200_000,
  closingCash: null,
  openedAt: "2026-09-05 01:00:00",
  closedAt: null,
  notes: null,
  status: "open",
}

const getActive = vi.mocked(shiftsApi.getActiveShift)
const open = vi.mocked(shiftsApi.openShift)

beforeEach(() => {
  vi.clearAllMocks()
  useShiftStore.setState({ activeShift: null })
})

describe("useShiftStore", () => {
  it("fetchActiveShift stores the server's shift", async () => {
    getActive.mockResolvedValue(SHIFT)
    await expect(useShiftStore.getState().fetchActiveShift()).resolves.toEqual(SHIFT)
    expect(useShiftStore.getState().activeShift).toEqual(SHIFT)
  })

  it("fetchActiveShift maps an empty body to null", async () => {
    getActive.mockResolvedValue(undefined as unknown as Shift)
    await expect(useShiftStore.getState().fetchActiveShift()).resolves.toBeNull()
    expect(useShiftStore.getState().activeShift).toBeNull()
  })

  it("fetchActiveShift clears a stale shift on error", async () => {
    useShiftStore.setState({ activeShift: SHIFT })
    getActive.mockRejectedValue(new Error("down"))
    await expect(useShiftStore.getState().fetchActiveShift()).resolves.toBeNull()
    expect(useShiftStore.getState().activeShift).toBeNull()
  })

  it("openShift reports an already-open shift without opening a new one", async () => {
    getActive.mockResolvedValue(SHIFT)
    await expect(useShiftStore.getState().openShift(50_000)).resolves.toEqual({
      shift: SHIFT,
      alreadyOpen: true,
    })
    expect(open).not.toHaveBeenCalled()
    expect(useShiftStore.getState().activeShift).toEqual(SHIFT)
  })

  it("openShift opens a fresh shift with the opening cash", async () => {
    getActive.mockResolvedValue(null as unknown as Shift)
    open.mockResolvedValue(SHIFT)
    await expect(useShiftStore.getState().openShift(200_000)).resolves.toEqual({
      shift: SHIFT,
      alreadyOpen: false,
    })
    expect(open).toHaveBeenCalledWith({ openingCash: 200_000 })
    expect(useShiftStore.getState().activeShift).toEqual(SHIFT)
  })

  it("clearShift resets the active shift", () => {
    useShiftStore.setState({ activeShift: SHIFT })
    useShiftStore.getState().clearShift()
    expect(useShiftStore.getState().activeShift).toBeNull()
  })
})
