import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

import { useCartStore } from "./hooks/use-cart-store"
import { PpobQuickAccess } from "./components/ppob-quick-access"

const PLN_DENOMS = [
  { id: 1, denom: "20000" },
  { id: 2, denom: "50000" },
]

function renderQuickAccess() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PpobQuickAccess />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation((command: string) => {
    if (command === "ppob_get_saldo") {
      return Promise.resolve({ saldo: 1_500_000, username: "toko" })
    }
    if (command === "ppob_get_pln_denom") return Promise.resolve(PLN_DENOMS)
    if (command === "get_app_settings") return Promise.resolve({})
    return Promise.resolve(null)
  })
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
  })
})

describe("ppob quick access", () => {
  it("shows the balance and the service tiles", async () => {
    renderQuickAccess()

    expect(await screen.findByText("Rp 1.500.000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pulsa/ })).toBeInTheDocument()
  })

  it("opens a service and comes back", async () => {
    renderQuickAccess()

    fireEvent.click(await screen.findByRole("button", { name: "Token PLN" }))

    expect(
      await screen.findByRole("textbox", { name: "No. Meter / IDPEL" })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Kembali" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Pulsa/ })).toBeInTheDocument()
    )
  })

  /**
   * Dua mode PLN dulu dirender sebagai `Tabs` tanpa panel — struktur yang bohong
   * ke pembaca layar. `ToggleButtonGroup` selection tunggal merendernya sebagai
   * radiogroup, jadi status terpilihnya benar-benar terbaca.
   */
  it("switches the PLN mode with a radio group, not a tab list", async () => {
    renderQuickAccess()

    fireEvent.click(await screen.findByRole("button", { name: "Token PLN" }))
    await screen.findByRole("textbox", { name: "No. Meter / IDPEL" })

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    const prepaid = screen.getByRole("radio", { name: "Token (Prepaid)" })
    const postpaid = screen.getByRole("radio", { name: "Bayar (Pascabayar)" })
    expect(prepaid).toHaveAttribute("aria-checked", "true")

    fireEvent.click(postpaid)

    await waitFor(() => expect(postpaid).toHaveAttribute("aria-checked", "true"))
    // Mode pascabayar tidak punya nominal, dan labelnya ikut berganti.
    expect(
      await screen.findByRole("textbox", { name: "ID Pelanggan" })
    ).toBeInTheDocument()
  })

  it("marks the chosen PLN denomination as pressed", async () => {
    renderQuickAccess()

    fireEvent.click(await screen.findByRole("button", { name: "Token PLN" }))

    // Regex, bukan string persis: `Intl` menyisipkan spasi tak-putus setelah "Rp".
    const denom = await screen.findByRole("button", { name: /50\.000/ })
    expect(denom).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(denom)

    await waitFor(() => expect(denom).toHaveAttribute("aria-pressed", "true"))
  })
})
