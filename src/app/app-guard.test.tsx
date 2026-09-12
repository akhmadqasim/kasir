import { beforeEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"

import { apiGet } from "@/lib/api/client"
import { installApiMock, apiFailure, type ApiMock } from "@/test-utils/api-mock"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { AppProviders } from "./providers"
import { queryClient } from "./query-client"
import { AppGuard, AdminRouteGuard } from "./app-guard"
import type { User } from "@/features/auth/types"

/**
 * Who gets in, and what happens when the session goes away mid-shift.
 *
 * The identity used to come from `localStorage`, so the guard could answer
 * synchronously and a stale entry let someone through until the first command
 * failed. It now comes from `GET /api/auth/me`, which makes two things worth
 * pinning down: the guard must wait for that answer rather than bouncing a
 * valid session to the login screen while it is in flight, and a 401 from
 * anywhere else must land the user on the login screen *once* — not in a loop
 * between the guard and the request that keeps failing.
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

const ADMIN: User = { ...KASIR, id: 1, username: "admin", role: "admin" }

let api: ApiMock

function CashierScreen() {
  return <p>Layar Kasir</p>
}

function AdminScreen() {
  return <p>Layar Admin</p>
}

function LoginScreen() {
  return <p>Halaman Login</p>
}

function OnboardingScreen() {
  return <p>Halaman Onboarding</p>
}

function renderApp(initialPath = "/cashier") {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginScreen /> },
      { path: "/onboarding", element: <OnboardingScreen /> },
      {
        path: "/",
        element: <AppGuard />,
        children: [
          { path: "cashier", element: <CashierScreen /> },
          {
            element: <AdminRouteGuard />,
            children: [{ path: "settings", element: <AdminScreen /> }],
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

beforeEach(() => {
  // The app owns one client for the life of the module, and `/auth/me` is cached
  // with `staleTime: Infinity` — exactly as the app wants it, and exactly what
  // would carry one test's session into the next.
  queryClient.clear()
  useAuthStore.setState({ user: null, isResolved: false })
  api = installApiMock({
    "GET /onboarding/status": false,
    "GET /auth/me": KASIR,
  })
})

describe("boot lewat /auth/me", () => {
  it("menampilkan layar setelah sesi terjawab", async () => {
    renderApp()

    expect(await screen.findByText("Layar Kasir")).toBeInTheDocument()
    expect(api.callsFor("GET /auth/me")).toHaveLength(1)
  })

  /**
   * The race the old store had no answer for. The query resolves, React commits,
   * and the store is written from inside the query function rather than from an
   * effect — so there is never a frame where the guard has a resolved query and
   * an empty store and reads that as "not logged in".
   */
  it("tidak melempar ke login selagi /auth/me masih berjalan", async () => {
    let release: () => void = () => {}
    const pending = new Promise<User>((resolve) => {
      release = () => resolve(KASIR)
    })
    api.route("GET /auth/me", () => pending)

    renderApp()

    expect(screen.getByText("Memuat...")).toBeInTheDocument()
    expect(screen.queryByText("Halaman Login")).not.toBeInTheDocument()

    release()
    expect(await screen.findByText("Layar Kasir")).toBeInTheDocument()
    expect(screen.queryByText("Halaman Login")).not.toBeInTheDocument()
  })

  it("mengarahkan ke login ketika belum ada yang login", async () => {
    api.route("GET /auth/me", apiFailure(401, "auth", "Sesi tidak valid."))

    renderApp()

    expect(await screen.findByText("Halaman Login")).toBeInTheDocument()
  })

  /**
   * A 401 on `/auth/me` is the ordinary first run of the day, not an expired
   * session. If it went through the global handler it would clear the cache the
   * query had just filled, the query would refetch, and the two would chase each
   * other. One request is the proof that it does not.
   */
  it("tidak berputar saat /auth/me menjawab 401", async () => {
    api.route("GET /auth/me", apiFailure(401, "auth", "Sesi tidak valid."))

    renderApp()
    await screen.findByText("Halaman Login")
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.callsFor("GET /auth/me")).toHaveLength(1)
  })

  it("mengarahkan ke onboarding sebelum toko disiapkan", async () => {
    api.route("GET /onboarding/status", true)

    renderApp()

    expect(await screen.findByText("Halaman Onboarding")).toBeInTheDocument()
  })
})

describe("401 di tengah pemakaian", () => {
  /**
   * The central handler drops the cached user and the cached `/auth/me` answer.
   * The guard notices the user is gone and renders the login screen itself —
   * nothing navigates imperatively, which is what stops a burst of failing
   * requests from issuing a burst of redirects.
   */
  it("memulangkan kasir ke login tanpa berputar", async () => {
    renderApp()
    await screen.findByText("Layar Kasir")

    api.route("GET /products", apiFailure(401, "auth", "Sesi tidak valid."))
    await apiGet("/products").catch(() => {})

    expect(await screen.findByText("Halaman Login")).toBeInTheDocument()
    expect(useAuthStore.getState().user).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.callsFor("GET /auth/me")).toHaveLength(1)
  })
})

describe("penjaga rute admin", () => {
  it("menahan kasir dari layar admin", async () => {
    renderApp("/settings")

    await screen.findByText("Layar Kasir")
    expect(screen.queryByText("Layar Admin")).not.toBeInTheDocument()
  })

  it("meloloskan admin", async () => {
    api.route("GET /auth/me", ADMIN)

    renderApp("/settings")

    expect(await screen.findByText("Layar Admin")).toBeInTheDocument()
  })
})

/**
 * The role the guard reads now comes from the server. Rewriting it in
 * `localStorage` — which used to be enough to open every admin screen — has
 * nothing to rewrite.
 */
describe("identitas tidak dapat dipalsukan lewat localStorage", () => {
  it("mengabaikan entri kasir-auth yang ditanam", async () => {
    localStorage.setItem(
      "kasir-auth",
      JSON.stringify({ state: { user: { ...KASIR, role: "admin" } } }),
    )

    renderApp("/settings")

    await screen.findByText("Layar Kasir")
    expect(screen.queryByText("Layar Admin")).not.toBeInTheDocument()
    localStorage.clear()
  })
})
