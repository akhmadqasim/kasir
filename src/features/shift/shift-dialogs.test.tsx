import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

import type { User } from "@/features/auth/types"
import type { Shift } from "./types"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "./hooks/use-shift-store"
import { CashFlowDialog } from "./components/cash-flow-dialog"
import { OpenShiftDialog } from "./components/open-shift-dialog"

const KASIR: User = {
  id: 2,
  username: "kasir01",
  full_name: "Kasir Satu",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

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

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation((command: string) => {
    if (command === "get_active_shift") return Promise.resolve(null)
    if (command === "open_shift") return Promise.resolve(SHIFT)
    if (command === "create_cash_flow") return Promise.resolve(null)
    return Promise.resolve(null)
  })
  useAuthStore.setState({ user: KASIR })
  useShiftStore.setState({ activeShift: null })
})

/**
 * Uang yang diketik kasir tidak boleh berubah bentuk saat migrasi: kolom nominal
 * tetap kolom teks yang hanya menerima angka dan langsung memberi pemisah ribuan,
 * bukan `NumberField` yang baru mengunci nilainya saat blur.
 */
describe("dialog buka kasir", () => {
  it("memberi pemisah ribuan sambil diketik dan mengirim angka mentahnya", async () => {
    render(<OpenShiftDialog open onOpenChange={() => {}} />)

    const field = within(await screen.findByRole("dialog")).getByLabelText(
      "Modal Awal (Opsional)"
    )
    fireEvent.change(field, { target: { value: "50000" } })
    expect(field).toHaveValue("50.000")

    // Huruf dan tanda baca dibuang, bukan ditolak diam-diam.
    fireEvent.change(field, { target: { value: "Rp 1.250.000,-" } })
    expect(field).toHaveValue("1.250.000")

    fireEvent.click(screen.getByRole("button", { name: "Mulai Shift" }))

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_shift", {
        input: { userId: 2, openingCash: 1_250_000 },
      })
    })
  })

  it("membuka shift tanpa modal awal saat kolomnya dibiarkan kosong", async () => {
    render(<OpenShiftDialog open onOpenChange={() => {}} />)

    await screen.findByRole("dialog")
    fireEvent.click(screen.getByRole("button", { name: "Mulai Shift" }))

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_shift", {
        input: { userId: 2, openingCash: undefined },
      })
    })
  })
})

describe("dialog arus kas", () => {
  it("baru bisa disimpan setelah jenis, nominal, dan keterangan terisi", async () => {
    useShiftStore.setState({ activeShift: SHIFT })
    render(<CashFlowDialog open onOpenChange={() => {}} />)

    const dialog = within(await screen.findByRole("dialog"))
    const save = dialog.getByRole("button", { name: "Simpan" })
    expect(save).toBeDisabled()

    fireEvent.change(dialog.getByLabelText("Nominal"), { target: { value: "25000" } })
    fireEvent.change(dialog.getByLabelText("Keterangan"), {
      target: { value: "Bayar supplier" },
    })
    // Jenis belum dipilih, jadi tombolnya harus tetap mati.
    expect(save).toBeDisabled()

    fireEvent.click(dialog.getByRole("button", { name: "Uang Keluar" }))
    expect(save).toBeEnabled()

    fireEvent.click(save)

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_cash_flow", {
        input: {
          shiftId: 9,
          userId: 2,
          flowType: "out",
          amount: 25_000,
          description: "Bayar supplier",
        },
      })
    })
  })
})
