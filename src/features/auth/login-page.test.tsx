import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
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
    </QueryClientProvider>
  )
}

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
})
