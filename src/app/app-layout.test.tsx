import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { installApiMock, type ApiCall, type ApiMock } from "@/test-utils/api-mock"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import type { WindowZoom } from "@/lib/api/window"
import { AppLayout } from "./app-layout"
import { LEGACY_ZOOM_KEY } from "./use-window-zoom"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin Toko",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const UP_TO_DATE = { current_version: "1.0.0", phase: "up_to_date" }

let api: ApiMock

/** Answers a PUT the way the real server does: with the factor it was sent. */
function echoZoom(call: ApiCall): WindowZoom {
  const { factor } = call.body as { factor: number }
  current = { ...current, factor }
  return current
}

let current: WindowZoom

/** A server whose zoom starts at `initial` and remembers what it is sent. */
function installZoomServer(initial: WindowZoom) {
  current = initial
  api = installApiMock({
    "GET /updates": UP_TO_DATE,
    "GET /window/zoom": () => current,
    "PUT /window/zoom": echoZoom,
  })
}

function renderLayout() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<p>Isi halaman</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function zoomLabel() {
  return screen.getByRole("button", { name: /%$/ })
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ user: ADMIN })
})

describe("AppLayout zoom", () => {
  it("menampilkan faktor dari server dan mengirim langkah berikutnya lewat PUT", async () => {
    installZoomServer({ factor: 1.2, available: true })
    renderLayout()

    expect(await screen.findByRole("button", { name: "120%" })).toBeInTheDocument()

    // Hold the first answer back: the label has to move before it arrives.
    let release: (value: WindowZoom) => void = () => {}
    api.route("PUT /window/zoom", () => new Promise<WindowZoom>((resolve) => (release = resolve)))
    fireEvent.click(screen.getByRole("button", { name: "Perbesar tampilan" }))
    await vi.waitFor(() => expect(zoomLabel()).toHaveTextContent("130%"))
    expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1.3 })
    release({ factor: 1.3, available: true })
    api.route("PUT /window/zoom", echoZoom)

    fireEvent.click(screen.getByRole("button", { name: "Perkecil tampilan" }))
    await vi.waitFor(() => expect(api.callsFor("PUT /window/zoom")).toHaveLength(2))
    expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1.2 })

    fireEvent.click(zoomLabel())
    await vi.waitFor(() => expect(api.callsFor("PUT /window/zoom")).toHaveLength(3))
    expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1 })
    expect(zoomLabel()).toHaveTextContent("100%")
  })

  it("Ctrl+/−/0 menggerakkan zoom dan tidak lolos ke webview", async () => {
    installZoomServer({ factor: 1, available: true })
    renderLayout()
    await screen.findByRole("button", { name: "100%" })

    const plus = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, cancelable: true })
    fireEvent(window, plus)
    expect(plus.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1.1 }))

    fireEvent(window, new KeyboardEvent("keydown", { key: "-", ctrlKey: true }))
    await vi.waitFor(() => expect(api.callsFor("PUT /window/zoom")).toHaveLength(2))
    expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1 })

    // Reset from 100 % is a no-op: nothing to send.
    fireEvent(window, new KeyboardEvent("keydown", { key: "0", ctrlKey: true }))
    fireEvent(window, new KeyboardEvent("keydown", { key: "+", ctrlKey: true }))
    await vi.waitFor(() => expect(api.callsFor("PUT /window/zoom")).toHaveLength(3))
    expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1.1 })
  })

  it("tidak melewati batas: tombol mati di ujung rentang", async () => {
    installZoomServer({ factor: 2, available: true })
    renderLayout()

    expect(await screen.findByRole("button", { name: "200%" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Perbesar tampilan" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Perkecil tampilan" })).toBeEnabled()

    // Ctrl++ at the ceiling sends nothing either.
    fireEvent(window, new KeyboardEvent("keydown", { key: "+", ctrlKey: true }))
    await screen.findByText("Isi halaman")
    expect(api.callsFor("PUT /window/zoom")).toHaveLength(0)
  })

  it("menyembunyikan toolbar dan membiarkan Ctrl+/− ke browser di klien LAN", async () => {
    installZoomServer({ factor: 1.5, available: false })
    renderLayout()

    await vi.waitFor(() => expect(api.callsFor("GET /window/zoom").length).toBeGreaterThan(0))
    await screen.findByText("Isi halaman")
    expect(screen.queryByRole("button", { name: "Perbesar tampilan" })).not.toBeInTheDocument()

    const plus = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, cancelable: true })
    fireEvent(window, plus)
    expect(plus.defaultPrevented).toBe(false)
    expect(api.callsFor("PUT /window/zoom")).toHaveLength(0)
  })

  it("memindahkan zoom lama dari localStorage ke server sekali, lalu menghapusnya", async () => {
    localStorage.setItem(LEGACY_ZOOM_KEY, "1.5")
    installZoomServer({ factor: 1, available: true })
    renderLayout()

    await vi.waitFor(() => expect(api.lastCall("PUT /window/zoom")?.body).toEqual({ factor: 1.5 }))
    expect(await screen.findByRole("button", { name: "150%" })).toBeInTheDocument()
    expect(localStorage.getItem(LEGACY_ZOOM_KEY)).toBeNull()
  })

  it("membuang kunci lama tanpa mengirim bila nilainya sama atau klien bukan jendela kasir", async () => {
    localStorage.setItem(LEGACY_ZOOM_KEY, "1.5")
    installZoomServer({ factor: 1.5, available: true })
    renderLayout()
    await screen.findByRole("button", { name: "150%" })
    expect(api.callsFor("PUT /window/zoom")).toHaveLength(0)
    expect(localStorage.getItem(LEGACY_ZOOM_KEY)).toBeNull()

    localStorage.setItem(LEGACY_ZOOM_KEY, "0.8")
    installZoomServer({ factor: 1, available: false })
    renderLayout()
    await vi.waitFor(() => expect(localStorage.getItem(LEGACY_ZOOM_KEY)).toBeNull())
    expect(api.callsFor("PUT /window/zoom")).toHaveLength(0)
  })
})
