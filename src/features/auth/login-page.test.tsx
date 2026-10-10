import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { apiFailure, installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { stubLoadedImages } from "@/test-utils/loaded-image"
import { useShiftStore } from "@/features/shift"
import { useAuthStore } from "./hooks/use-auth-store"
import { useCartStore } from "@/stores/cart-store"
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
    // Sebelum onboarding server menjawab `null`; kasus dengan nama toko ada di bawah.
    "GET /store/public": null,
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

  it("shows a failed login inline, clears the PIN and puts the caret back in it", async () => {
    api.route("POST /auth/login", apiFailure(401, "auth", "Username atau PIN salah"))
    renderLoginPage()

    fireEvent.change(screen.getByLabelText("Nama Pengguna"), { target: { value: "kasir1" } })
    const pin = screen.getByLabelText("PIN")
    fireEvent.change(pin, { target: { value: "9999" } })
    fireEvent.keyDown(pin, { key: "Enter" })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Username atau PIN salah")
    expect(pin).toHaveValue("")
    await vi.waitFor(() => expect(pin).toHaveFocus())

    // Typing again dismisses the old message.
    fireEvent.change(pin, { target: { value: "1" } })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does nothing on Enter while the PIN is still empty", () => {
    renderLoginPage()

    fireEvent.change(screen.getByLabelText("Nama Pengguna"), { target: { value: "kasir1" } })
    fireEvent.keyDown(screen.getByLabelText("PIN"), { key: "Enter" })

    expect(api.callsFor("POST /auth/login")).toHaveLength(0)
  })
})

/**
 * Nama toko di atas formulir datang dari `GET /store/public` — rute publik yang
 * hanya membawa nama dan penanda logo, bukan baris toko lengkap.
 */
describe("login page store header", () => {
  it("shows the store name above the form", async () => {
    api.route("GET /store/public", { name: "Toko Berkah Jaya", has_logo: false })
    renderLoginPage()

    expect(await screen.findByRole("heading", { name: "Toko Berkah Jaya" })).toBeInTheDocument()
    expect(screen.getByText("Masuk ke POS")).toBeInTheDocument()
    expect(api.callsFor("GET /store/public")).toHaveLength(1)
  })

  it("falls back to the plain title before the store is set up", async () => {
    renderLoginPage()

    await vi.waitFor(() => expect(api.callsFor("GET /store/public")).toHaveLength(1))
    expect(screen.getByRole("heading", { name: "Masuk ke POS" })).toBeInTheDocument()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("draws the logo from the public logo route when the store has one", async () => {
    // jsdom never loads an image; HeroUI's Avatar only mounts `<img>` once it has.
    stubLoadedImages()
    api.route("GET /store/public", { name: "Toko Berkah Jaya", has_logo: true })
    const { container } = renderLoginPage()

    await screen.findByRole("heading", { name: "Toko Berkah Jaya" })
    await vi.waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toMatch(
        /\/api\/store\/logo\?v=\d+$/,
      ),
    )
  })

  // The public slice has no `updated_at`, and `/store/logo` is cached for an
  // hour: without a changing query string a logo replaced in Pengaturan kept
  // showing the old picture on the login screen.
  it("busts the logo cache with when the store slice was fetched", async () => {
    stubLoadedImages()
    api.route("GET /store/public", { name: "Toko Berkah Jaya", has_logo: true })
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000)

    const first = renderLoginPage()
    await vi.waitFor(() =>
      expect(first.container.querySelector("img")?.getAttribute("src")).toBe(
        "/api/store/logo?v=1000",
      ),
    )
    first.unmount()

    // The next visit to the login screen (after a logout, which empties the cache).
    now.mockReturnValue(2_000)
    const second = renderLoginPage()
    await vi.waitFor(() =>
      expect(second.container.querySelector("img")?.getAttribute("src")).toBe(
        "/api/store/logo?v=2000",
      ),
    )
    now.mockRestore()
  })
})

/**
 * A session that expires leaves the cart (in localStorage) and the shift
 * behind; the login that follows decides whether they stay.
 */
describe("login hands over the till", () => {
  const leftCart = {
    items: [
      {
        cart_id: "product-7",
        product_id: 7,
        product_name: "Beras 5kg",
        product_price: 68000,
        quantity: 1,
        stock: 10,
        unit: "pcs",
      },
    ],
    transactionDiscount: { type: "fixed" as const, value: 1000 },
    checkoutKey: "kunci-lama",
  }

  // The login screen only shows once the session is gone, the cached user with it.
  beforeEach(() => {
    useAuthStore.setState({ user: null })
  })

  async function logInAsKasir1() {
    renderLoginPage()
    fireEvent.change(screen.getByLabelText("Nama Pengguna"), { target: { value: "kasir1" } })
    const pin = screen.getByLabelText("PIN")
    fireEvent.change(pin, { target: { value: "1234" } })
    fireEvent.keyDown(pin, { key: "Enter" })
    await vi.waitFor(() => expect(useCartStore.getState().ownerId).toBe(1))
  }

  it("empties the cart and the shift another cashier left behind", async () => {
    useCartStore.setState({ ...leftCart, ownerId: 2 })
    useShiftStore.setState({ activeShift: { id: 9 } as never })

    await logInAsKasir1()

    expect(useCartStore.getState().items).toEqual([])
    expect(useCartStore.getState().transactionDiscount).toBeNull()
    expect(useCartStore.getState().checkoutKey).toBeNull()
    expect(useShiftStore.getState().activeShift).toBeNull()
  })

  it("keeps the cart for the same cashier logging back in after an expiry", async () => {
    useCartStore.setState({ ...leftCart, ownerId: 1 })
    useShiftStore.setState({ activeShift: { id: 9 } as never })

    await logInAsKasir1()

    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().checkoutKey).toBe("kunci-lama")
    expect(useShiftStore.getState().activeShift).toEqual({ id: 9 })
  })
})
