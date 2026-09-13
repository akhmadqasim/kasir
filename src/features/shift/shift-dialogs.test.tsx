import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import type { User } from "@/features/auth/types"
import type { Shift } from "./types"

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

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    // Membuka shift bertanya dulu apakah sudah ada yang terbuka; belum ada.
    "GET /shifts/active": null,
    "POST /shifts": SHIFT,
    "POST /shifts/*/cash-flows": null,
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

    const field = within(await screen.findByRole("dialog")).getByLabelText("Modal awal")
    fireEvent.change(field, { target: { value: "50000" } })
    expect(field).toHaveValue("50.000")

    // Huruf dan tanda baca dibuang, bukan ditolak diam-diam.
    fireEvent.change(field, { target: { value: "Rp 1.250.000,-" } })
    expect(field).toHaveValue("1.250.000")

    fireEvent.click(screen.getByRole("button", { name: "Mulai Shift" }))

    await vi.waitFor(() => {
      // Pemilik shift diambil dari sesi, jadi yang dikirim tinggal modal awalnya.
      expect(api.lastCall("POST /shifts")?.body).toEqual({ openingCash: 1_250_000 })
    })
  })

  it("membuka shift tanpa modal awal saat kolomnya dibiarkan kosong", async () => {
    render(<OpenShiftDialog open onOpenChange={() => {}} />)

    await screen.findByRole("dialog")
    fireEvent.click(screen.getByRole("button", { name: "Mulai Shift" }))

    await vi.waitFor(() => {
      expect(api.lastCall("POST /shifts")?.body).toEqual({})
    })
  })
})

describe("dialog arus kas", () => {
  it("bisa disimpan begitu nominal terisi; jenis mulai di Uang Masuk", async () => {
    useShiftStore.setState({ activeShift: SHIFT })
    render(<CashFlowDialog open onOpenChange={() => {}} />)

    const dialog = within(await screen.findByRole("dialog"))
    const save = dialog.getByRole("button", { name: "Simpan" })
    expect(save).toBeDisabled()
    expect(dialog.getByRole("radio", { name: "Uang Masuk" })).toBeChecked()

    fireEvent.change(dialog.getByLabelText("Nominal"), { target: { value: "25000" } })
    expect(save).toBeEnabled()
    fireEvent.change(dialog.getByLabelText(/Keterangan/), {
      target: { value: "Bayar supplier" },
    })

    // `ToggleButtonGroup` pilihan tunggal dirender React Aria sebagai radiogroup.
    fireEvent.click(dialog.getByRole("radio", { name: "Uang Keluar" }))

    // Enter di kolom nominal mengirim form, tanpa harus ke tombol Simpan.
    fireEvent.submit(dialog.getByLabelText("Nominal").closest("form")!)

    await vi.waitFor(() => {
      // Shift-nya ada di path, penulisnya di sesi; sisanya yang jadi badan.
      const call = api.lastCall("POST /shifts/*/cash-flows")
      expect(call?.path).toBe("/shifts/9/cash-flows")
      expect(call?.body).toEqual({
        flowType: "out",
        amount: 25_000,
        description: "Bayar supplier",
      })
    })
  })
})
