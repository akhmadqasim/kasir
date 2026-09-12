import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { User } from "@/features/auth/types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { UsersPage } from "./components/users-page"

function user(id: number, username: string, role: "admin" | "kasir", isActive = true): User {
  return {
    id,
    username,
    full_name: `${username} lengkap`,
    role,
    is_active: isActive,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  }
}

const ADMIN = user(1, "admin", "admin")
const USERS = [ADMIN, user(2, "kasir01", "kasir"), user(3, "kasir02", "kasir", false)]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TestNavbar>
        <UsersPage />
      </TestNavbar>
    </QueryClientProvider>,
  )
}

function usersTable() {
  return screen.getByRole("grid", { name: "Manajemen User" })
}

let api: ApiMock

/** Panggilan aktivasi/penonaktifan; user yang dituju ada di URL-nya, bukan di body. */
const TOGGLE_ACTIVE = "PATCH /users/*/active"

beforeEach(() => {
  api = installApiMock({
    "GET /users": USERS,
    [TOGGLE_ACTIVE]: USERS[1],
    "POST /users": USERS[1],
  })
  useAuthStore.setState({ user: ADMIN })
})

/**
 * Manajemen pengguna adalah layar admin, tapi dialognya menyimpan kontrol PIN yang
 * dipakai kasir juga. Yang dijaga: daftar tersaring, penonaktifan tetap minta
 * konfirmasi, dan formulir PIN tetap memvalidasi sendiri di dalam dialog HeroUI.
 */
describe("halaman manajemen user", () => {
  it("menyaring daftar lewat kolom pencarian", async () => {
    renderPage()

    await screen.findByText("kasir01")
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kasir02" } })

    const table = within(usersTable())
    expect(table.getByText("kasir02")).toBeInTheDocument()
    expect(table.queryByText("kasir01")).not.toBeInTheDocument()
  })

  it("meminta konfirmasi sebelum menonaktifkan, dan tidak menawarkannya untuk diri sendiri", async () => {
    renderPage()

    await screen.findByText("kasir01")
    expect(screen.queryByRole("button", { name: /Nonaktifkan admin/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan kasir01" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Yakin ingin menonaktifkan user ini?")).toBeInTheDocument()
    expect(api.callsFor(TOGGLE_ACTIVE)).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }))

    await vi.waitFor(() => {
      const call = api.lastCall(TOGGLE_ACTIVE)
      expect(call?.path).toBe("/users/2/active")
      expect(call?.body).toEqual({ isActive: false })
    })
  })

  /**
   * HeroUI mematikan Escape pada `AlertDialog` secara bawaan; dialog Radix yang
   * digantikannya tidak. Kasir dan admin sama-sama menekan Escape untuk mundur.
   */
  it("menutup konfirmasi dengan Escape", async () => {
    renderPage()

    await screen.findByText("kasir01")
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan kasir01" }))

    const dialog = await screen.findByRole("alertdialog")
    fireEvent.keyDown(dialog, { key: "Escape" })

    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(api.callsFor(TOGGLE_ACTIVE)).toHaveLength(0)
  })

  it("mengaktifkan kembali user nonaktif tanpa konfirmasi", async () => {
    renderPage()

    await screen.findByText("kasir02")
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan kasir02" }))

    await vi.waitFor(() => {
      const call = api.lastCall(TOGGLE_ACTIVE)
      expect(call?.path).toBe("/users/3/active")
      expect(call?.body).toEqual({ isActive: true })
    })
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("menolak PIN yang tidak cocok dan tetap bisa dikirim ulang setelah diperbaiki", async () => {
    renderPage()

    await screen.findByText("kasir01")
    fireEvent.click(screen.getByRole("button", { name: "Tambah User" }))

    const dialog = await screen.findByRole("dialog")
    const form = within(dialog)

    fireEvent.change(form.getByLabelText("Username"), { target: { value: "kasir03" } })
    fireEvent.change(form.getByLabelText("Nama Lengkap"), { target: { value: "Kasir Tiga" } })
    fireEvent.change(form.getByLabelText("PIN"), { target: { value: "1234" } })
    fireEvent.change(form.getByLabelText("Konfirmasi PIN"), { target: { value: "9999" } })

    fireEvent.click(form.getByRole("button", { name: "Simpan" }))
    expect(await form.findByText("PIN tidak cocok")).toBeInTheDocument()
    expect(api.callsFor("POST /users")).toHaveLength(0)

    // React Aria memblokir submit berikutnya kalau field invalid memakai validasi
    // native, jadi form harus tetap bisa dikirim setelah errornya diperbaiki.
    fireEvent.change(form.getByLabelText("Konfirmasi PIN"), { target: { value: "1234" } })
    fireEvent.click(form.getByRole("button", { name: "Simpan" }))

    await vi.waitFor(() => {
      expect(api.lastCall("POST /users")?.body).toEqual({
        username: "kasir03",
        fullName: "Kasir Tiga",
        role: "kasir",
        pin: "1234",
      })
    })
  })

  it("hanya menerima angka di kolom PIN", async () => {
    renderPage()

    await screen.findByText("kasir01")
    fireEvent.click(screen.getByRole("button", { name: "Tambah User" }))

    const pin = within(await screen.findByRole("dialog")).getByLabelText("PIN")
    fireEvent.change(pin, { target: { value: "12ab34" } })

    expect(pin).toHaveValue("1234")
    expect(pin).toHaveAttribute("type", "password")
  })
})
