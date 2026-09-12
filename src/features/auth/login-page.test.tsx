import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { LoginPage } from "./components/login-page"

function renderLoginPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "POST /auth/login": {
      id: 1,
      username: "kasir1",
      full_name: "Kasir Satu",
      role: "kasir",
      is_active: true,
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    },
  })
})

/**
 * Alur keyboard kasir: fokus jatuh ke username, tombol masuk baru aktif setelah
 * username dan PIN terisi, dan PIN hanya menerima angka.
 */
describe("login page", () => {
  it("focuses username and keeps the submit button disabled until both fields are filled", () => {
    renderLoginPage()

    const username = screen.getByLabelText("Nama Pengguna")
    const pin = screen.getByLabelText("PIN")
    const submit = screen.getByRole("button", { name: "Masuk" })

    expect(username).toHaveFocus()
    expect(submit).toBeDisabled()

    fireEvent.change(username, { target: { value: "kasir1" } })
    expect(submit).toBeDisabled()

    fireEvent.change(pin, { target: { value: "1234" } })
    expect(submit).toBeEnabled()
  })

  it("masks the PIN and drops non-digit input", () => {
    renderLoginPage()

    const pin = screen.getByLabelText("PIN")
    expect(pin).toHaveAttribute("type", "password")
    expect(pin).toHaveAttribute("inputmode", "numeric")

    fireEvent.change(pin, { target: { value: "12ab34" } })
    expect(pin).toHaveValue("1234")
  })

  /**
   * Kasir masuk dengan dua tangan di papan ketik dan tidak pernah menekan Tab.
   * Kedua test di bawah menjaga rantai itu utuh. Keduanya menegaskan perilaku
   * yang ditangani sendiri oleh komponen, bukan pengiriman implisit milik
   * browser — jsdom memang tidak mengimplementasikannya, tapi lebih penting
   * lagi, syarat pengiriman implisit (harus ada tombol submit yang tidak
   * nonaktif) tidak terpenuhi selama PIN masih kosong.
   */
  it("moves focus from username to the PIN field on Enter", () => {
    renderLoginPage()

    const username = screen.getByLabelText("Nama Pengguna")
    const pin = screen.getByLabelText("PIN")

    fireEvent.change(username, { target: { value: "kasir1" } })
    fireEvent.keyDown(username, { key: "Enter" })

    expect(pin).toHaveFocus()
  })

  it("logs in when Enter is pressed in the PIN field", async () => {
    renderLoginPage()

    fireEvent.change(screen.getByLabelText("Nama Pengguna"), { target: { value: " kasir1 " } })
    const pin = screen.getByLabelText("PIN")
    fireEvent.change(pin, { target: { value: "1234" } })
    fireEvent.keyDown(pin, { key: "Enter" })

    await vi.waitFor(() => expect(api.callsFor("POST /auth/login")).toHaveLength(1))
    // Spasi di sekitar username dipangkas sebelum dikirim.
    expect(api.lastCall("POST /auth/login")?.body).toEqual({ username: "kasir1", pin: "1234" })
  })

  it("does nothing on Enter while the PIN is still empty", () => {
    renderLoginPage()

    fireEvent.change(screen.getByLabelText("Nama Pengguna"), { target: { value: "kasir1" } })
    fireEvent.keyDown(screen.getByLabelText("PIN"), { key: "Enter" })

    expect(api.callsFor("POST /auth/login")).toHaveLength(0)
  })
})
