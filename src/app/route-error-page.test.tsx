import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { ApiError } from "@/lib/api/client"
import type { User } from "@/features/auth/types"
import { ErrorBoundary } from "./error-boundary"
import { RouteErrorPage } from "./route-error-page"

/**
 * What the cashier sees when a screen breaks or an address does not exist —
 * instead of react-router's own "You can provide a way better UX than this".
 * The copy must be Indonesian, the actions must be there, and pressing the
 * home button must actually leave the broken screen.
 */

const KASIR: User = {
  id: 2,
  username: "kasir01",
  full_name: "Kasir Satu",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

function Crash(): never {
  throw new Error("Keranjang tidak bisa dibaca")
}

function throwNotFound(): never {
  throw new Response(null, { status: 404, statusText: "Not Found" })
}

function Forbidden(): never {
  throw new ApiError("forbidden", "Hanya admin yang boleh membuka pengaturan", 403)
}

function MissingData(): never {
  throw new ApiError("not_found", "Transaksi tidak ditemukan", 404)
}

function renderRouter(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        errorElement: <RouteErrorPage />,
        children: [
          { path: "cashier", element: <p>Layar Kasir</p> },
          { path: "dashboard", element: <p>Layar Dashboard</p> },
          { path: "broken", element: <Crash /> },
          { path: "forbidden", element: <Forbidden /> },
          { path: "missing", element: <MissingData /> },
          { path: "*", loader: throwNotFound },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  )
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  useAuthStore.setState({ user: null, isResolved: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("RouteErrorPage", () => {
  it("names the crash in plain Indonesian with the message shown straight away", async () => {
    useAuthStore.setState({ user: KASIR, isResolved: true })
    renderRouter("/broken")

    expect(await screen.findByText("Terjadi kesalahan")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Kembali ke kasir" })).toBeInTheDocument()

    // The message is on screen for the admin to photograph, no click needed.
    expect(screen.getByText(/Keranjang tidak bisa dibaca/)).toBeVisible()
  })

  it("sends an admin back to the dashboard, and the home button really navigates", async () => {
    useAuthStore.setState({ user: { ...KASIR, id: 1, role: "admin" }, isResolved: true })
    renderRouter("/broken")

    fireEvent.click(await screen.findByRole("button", { name: "Kembali ke dashboard" }))

    expect(await screen.findByText("Layar Dashboard")).toBeInTheDocument()
    expect(screen.queryByText("Terjadi kesalahan")).not.toBeInTheDocument()
  })

  it("treats an unknown address as not found, with nothing to retry", async () => {
    useAuthStore.setState({ user: KASIR, isResolved: true })
    renderRouter("/halaman-yang-tidak-ada")

    expect(await screen.findByText("Halaman tidak ditemukan")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Kembali ke kasir" }))
    expect(await screen.findByText("Layar Kasir")).toBeInTheDocument()
  })

  it("treats a forbidden ApiError as no access, and any other ApiError as a crash with its own message", async () => {
    useAuthStore.setState({ user: KASIR, isResolved: true })
    renderRouter("/forbidden")

    expect(await screen.findByText("Tidak punya akses")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument()

    cleanup()
    renderRouter("/missing")

    // A 404 from the API means the data is gone, not the page: still a crash,
    // but the server's own sentence replaces the generic one.
    expect(await screen.findByText("Terjadi kesalahan")).toBeInTheDocument()
    expect(screen.getByText("Transaksi tidak ditemukan")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument()
  })

  it("falls back to the front door when nobody is logged in", async () => {
    renderRouter("/broken")

    expect(
      await screen.findByRole("button", { name: "Kembali ke halaman utama" }),
    ).toBeInTheDocument()
  })
})

describe("ErrorBoundary", () => {
  it("draws the same screen for errors thrown outside the router", () => {
    useAuthStore.setState({ user: KASIR, isResolved: true })

    render(
      <ErrorBoundary>
        <Crash />
      </ErrorBoundary>,
    )

    expect(screen.getByText("Terjadi kesalahan")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Kembali ke kasir" })).toBeInTheDocument()
    // The details are on screen straight away, not behind a disclosure.
    expect(screen.queryByRole("button", { name: "Detail teknis" })).not.toBeInTheDocument()
  })
})
