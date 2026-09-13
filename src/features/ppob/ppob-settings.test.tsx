import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, installDeferredApiMock, type ApiMock } from "@/test-utils/api-mock"
import { SETTINGS, WRITABLE_PPOB } from "@/test-utils/settings-fixture"
import { TestNavbar } from "@/test-utils/test-navbar"
import { PpobSettings } from "./components/settings/ppob-settings"

let api: ApiMock

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TestNavbar>
          <PpobSettings />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function saveButtons() {
  return screen.getAllByRole("button", { name: "Simpan" })
}

beforeEach(() => {
  api = installApiMock({})
})

/**
 * The server rewrites all four settings blocks at once. If the form may save
 * before its query has answered, the blocks it does not own go out as
 * defaults. A save button that stays dead until the data is in is the only
 * thing preventing it.
 */
describe("pengaturan Mitra Indogrosir", () => {
  it("memasang judul sub-halaman dan tombol kembali di navbar", () => {
    api = installApiMock({ "GET /settings": SETTINGS })
    renderSettings()

    expect(screen.getByText("Pengaturan Mitra Indogrosir")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Kembali" })).toBeInTheDocument()
  })

  it("mematikan kedua tombol simpan sampai pengaturan dimuat", async () => {
    const deferred = installDeferredApiMock("GET /settings", SETTINGS)
    renderSettings()

    const buttons = saveButtons()
    expect(buttons).toHaveLength(2)
    buttons.forEach((button) => expect(button).toBeDisabled())

    deferred.release()
    await vi.waitFor(() => {
      saveButtons().forEach((button) => expect(button).toBeEnabled())
    })
  })

  it("tidak mengirim PUT /settings saat tombol masih mati", async () => {
    const deferred = installDeferredApiMock("GET /settings", SETTINGS, { "PUT /settings": null })
    api = deferred.api
    renderSettings()

    fireEvent.click(saveButtons()[0])
    expect(api.callsFor("PUT /settings")).toHaveLength(0)

    deferred.release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings")?.body).toEqual({
        sales: SETTINGS.sales,
        security: SETTINGS.security,
        backup: SETTINGS.backup,
        ppob: WRITABLE_PPOB,
      })
    })
  })

  /**
   * The failure this guards against: the form used to read the password back
   * out of `GET /settings`, hold it in a state field, and post it again on
   * every save. A save that ran before the query answered posted an empty one.
   */
  it("menyimpan tanpa menyentuh kredensial saat kolomnya dikosongkan", async () => {
    api = installApiMock({
      "GET /settings": SETTINGS,
      "PUT /settings": null,
      "PUT /settings/ppob/credentials": null,
    })
    renderSettings()

    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())
    fireEvent.click(saveButtons()[0])

    await vi.waitFor(() => expect(api.callsFor("PUT /settings")).toHaveLength(1))
    expect(api.callsFor("PUT /settings/ppob/credentials")).toHaveLength(0)
  })

  it("mengirim kredensial lewat endpoint sendiri saat keduanya diisi", async () => {
    api = installApiMock({
      "GET /settings": SETTINGS,
      "PUT /settings": null,
      "PUT /settings/ppob/credentials": null,
    })
    renderSettings()

    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.change(screen.getByLabelText("Password Mitra"), {
      target: { value: "rahasia-baru" },
    })
    fireEvent.change(screen.getByLabelText("PIN Transaksi"), {
      target: { value: "654321" },
    })
    fireEvent.click(saveButtons()[0])

    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings/ppob/credentials")?.body).toEqual({
        password: "rahasia-baru",
        pin: "654321",
      })
    })
    // The settings blob still cannot carry them, whatever was typed.
    expect(api.lastCall("PUT /settings")?.body).toEqual({
      sales: SETTINGS.sales,
      security: SETTINGS.security,
      backup: SETTINGS.backup,
      ppob: WRITABLE_PPOB,
    })
  })

  /** The markup card's Simpan writes the whole form, connection fields included. */
  it("menyimpan markup yang diubah lewat tombol simpan kartu Markup", async () => {
    api = installApiMock({ "GET /settings": SETTINGS, "PUT /settings": null })
    renderSettings()

    await vi.waitFor(() => expect(saveButtons()[1]).toBeEnabled())

    const plnValue = screen.getByRole("textbox", { name: "Nilai markup PLN" })
    fireEvent.change(plnValue, { target: { value: "2500" } })
    fireEvent.blur(plnValue)
    fireEvent.click(saveButtons()[1])

    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings")?.body).toMatchObject({
        ppob: {
          ...WRITABLE_PPOB,
          markup: { ...SETTINGS.ppob.markup, pln: { type: "fixed", value: 2500 } },
        },
      })
    })
  })
})
