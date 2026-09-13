import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { stubLoadedImages } from "@/test-utils/loaded-image"
import { id } from "@/i18n/id"
import type { StoreInfo } from "./types"

import { StoreInfoTab } from "./components/store-info-tab"

const STORE: StoreInfo = {
  id: 1,
  name: "Toko Sembako Maju",
  address: "Jl. Merdeka 1",
  phone: "081200000000",
  email: null,
  logo_path: null,
  additional_info: null,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-09-13 08:00:00",
}

const WITH_LOGO: StoreInfo = { ...STORE, logo_path: "store/logo.png" }

let api: ApiMock

function renderTab(store: StoreInfo, isAdmin = true) {
  api = installApiMock({
    "GET /store": store,
    "POST /settings/store/logo": WITH_LOGO,
    "DELETE /settings/store/logo": null,
  })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <StoreInfoTab isAdmin={isAdmin} />
    </QueryClientProvider>,
  )
}

function logoAvatar(container: HTMLElement) {
  return container.querySelector(".avatar")
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement | null
}

describe("blok logo toko di Info Toko", () => {
  beforeEach(() => {
    stubLoadedImages()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("menampilkan ikon bawaan dan tanpa tombol hapus selama belum ada logo", async () => {
    const { container } = renderTab(STORE)

    await screen.findByRole("button", { name: "Unggah logo" })
    expect(logoAvatar(container)?.querySelector(".avatar__fallback svg")).not.toBeNull()
    expect(logoAvatar(container)?.querySelector("img")).toBeNull()
    expect(screen.queryByRole("button", { name: "Hapus logo" })).toBeNull()
  })

  it("mengunggah berkas yang dipilih ke POST /settings/store/logo", async () => {
    const { container } = renderTab(STORE)

    await screen.findByRole("button", { name: "Unggah logo" })
    const input = fileInput(container)
    expect(input).not.toBeNull()
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp,image/svg+xml")

    const file = new File(["PNG"], "logo-toko.png", { type: "image/png" })
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })

    await vi.waitFor(() => expect(api.callsFor("POST /settings/store/logo")).toHaveLength(1))
    const body = api.lastCall("POST /settings/store/logo")?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get("file")).toBe(file)

    // The shared store query is re-read so the sidebar sees the new logo.
    await vi.waitFor(() => expect(api.callsFor("GET /store").length).toBeGreaterThan(1))
  })

  it("menampilkan logo yang ada dan menghapusnya lewat DELETE /settings/store/logo", async () => {
    const { container } = renderTab(WITH_LOGO)

    const remove = await screen.findByRole("button", { name: "Hapus logo" })
    await vi.waitFor(() => expect(logoAvatar(container)?.querySelector("img")).not.toBeNull())
    expect(logoAvatar(container)?.querySelector("img")?.getAttribute("src")).toContain(
      "/api/store/logo?v=",
    )

    fireEvent.click(remove)
    await vi.waitFor(() => expect(api.callsFor("DELETE /settings/store/logo")).toHaveLength(1))
  })

  it("hanya memperlihatkan pratinjau kepada kasir", async () => {
    const { container } = renderTab(WITH_LOGO, false)

    await screen.findByText(id.settings.storeLogo)
    expect(logoAvatar(container)).not.toBeNull()
    expect(screen.queryByRole("button", { name: "Unggah logo" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Hapus logo" })).toBeNull()
    expect(fileInput(container)).toBeNull()
  })
})
