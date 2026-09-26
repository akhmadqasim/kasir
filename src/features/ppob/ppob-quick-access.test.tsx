import { beforeEach, describe, expect, it } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { id } from "@/i18n/id"
import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { useCartStore } from "@/stores/cart-store"
import { PpobQuickAccess } from "./components/quick-access/ppob-quick-access"

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
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // Session-scoped, unlike `GET /api/settings` which is admin-only — this is
  // a cashier's screen. An empty object is "no markup configured", the same
  // answer a 403 used to fall back to.
  installApiMock({
    "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
    "GET /ppob/catalog/pln/denominations": PLN_DENOMS,
    "GET /settings/ppob/markup": {},
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

  /** The reason used to sit in a `title` attribute: no keyboard or screen reader reached it. */
  it("offers the balance failure reason on a focusable trigger", async () => {
    installApiMock({
      "GET /ppob/balance": apiFailure(502, "upstream", "Mitra sedang gangguan"),
      "GET /settings/ppob/markup": {},
    })
    renderQuickAccess()

    expect(await screen.findByText(id.ppob.quickAccess.saldoUnavailable)).toBeInTheDocument()
    const trigger = screen.getByRole("button", {
      name: id.ppob.quickAccess.saldoUnavailableReason,
    })

    // Keyboard modality, then focus: React Aria opens a tooltip on keyboard focus.
    fireEvent.keyDown(document.body, { key: "Tab" })
    fireEvent.keyUp(document.body, { key: "Tab" })
    act(() => trigger.focus())

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Mitra sedang gangguan")
  })

  it("opens a service and comes back", async () => {
    renderQuickAccess()

    fireEvent.click(await screen.findByRole("button", { name: "Token PLN" }))

    expect(
      await screen.findByRole("textbox", { name: id.ppob.quickAccess.plnMeter }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Kembali" }))

    await waitFor(() => expect(screen.getByRole("button", { name: /Pulsa/ })).toBeInTheDocument())
  })

  /**
   * Dua mode PLN dulu dirender sebagai `Tabs` tanpa panel — struktur yang bohong
   * ke pembaca layar. `ToggleButtonGroup` selection tunggal merendernya sebagai
   * radiogroup, jadi status terpilihnya benar-benar terbaca.
   */
  it("switches the PLN mode with a radio group, not a tab list", async () => {
    renderQuickAccess()

    fireEvent.click(await screen.findByRole("button", { name: "Token PLN" }))
    await screen.findByRole("textbox", { name: id.ppob.quickAccess.plnMeter })

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    const prepaid = screen.getByRole("radio", { name: id.ppob.quickAccess.plnToken })
    const postpaid = screen.getByRole("radio", { name: id.ppob.quickAccess.plnPostpaid })
    expect(prepaid).toHaveAttribute("aria-checked", "true")

    fireEvent.click(postpaid)

    await waitFor(() => expect(postpaid).toHaveAttribute("aria-checked", "true"))
    // Mode pascabayar tidak punya nominal, dan labelnya ikut berganti.
    expect(
      await screen.findByRole("textbox", { name: id.ppob.quickAccess.customerId }),
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

describe("ppob quick access — markup", () => {
  it("opens a service form while the markup is still loading", async () => {
    installApiMock({
      "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
      "GET /ppob/catalog/pln/denominations": PLN_DENOMS,
      "GET /settings/ppob/markup": () => new Promise(() => {}),
    })
    renderQuickAccess()

    fireEvent.click(await screen.findByRole("button", { name: "Token PLN" }))

    expect(
      await screen.findByRole("textbox", { name: id.ppob.quickAccess.plnMeter }),
    ).toBeInTheDocument()
  })
})
