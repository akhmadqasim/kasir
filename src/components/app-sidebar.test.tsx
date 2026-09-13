import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { AppSidebar } from "./app-sidebar"
import { SidebarProvider } from "@/components/layout/sidebar"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import type { StoreInfo } from "@/features/settings/types"
import { installApiMock } from "@/test-utils/api-mock"
import { stubLoadedImages } from "@/test-utils/loaded-image"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin Toko",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const STORE: StoreInfo = {
  id: 1,
  name: "Toko Sembako Maju",
  address: null,
  phone: null,
  email: null,
  logo_path: null,
  additional_info: null,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-09-13 08:00:00",
}

function renderSidebar(store: StoreInfo | null) {
  installApiMock({ "GET /store": store })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The brand row: `Avatar` 36px next to the app name. */
function brandAvatar() {
  return screen.getByRole("link", { name: /Point of Sale/ }).querySelector(".avatar")
}

describe("logo toko di kepala sidebar", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: ADMIN })
    stubLoadedImages()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("menggambar ikon bawaan selama toko belum punya logo", async () => {
    renderSidebar(STORE)

    await screen.findByRole("link", { name: /Point of Sale/ })
    const avatar = brandAvatar()
    expect(avatar?.querySelector(".avatar__fallback svg")).not.toBeNull()
    expect(avatar?.querySelector("img")).toBeNull()
  })

  it("menggambar ikon bawaan juga saat informasi toko belum ada", async () => {
    renderSidebar(null)

    await screen.findByRole("link", { name: /Point of Sale/ })
    expect(brandAvatar()?.querySelector(".avatar__fallback svg")).not.toBeNull()
  })

  it("memuat logo yang diunggah dari /api/store/logo dengan penanda versi", async () => {
    renderSidebar({ ...STORE, logo_path: "store/logo.png" })

    const img = await vi.waitFor(() => {
      const found = brandAvatar()?.querySelector("img")
      expect(found).not.toBeNull()
      return found as HTMLImageElement
    })
    expect(img.getAttribute("src")).toBe(
      `/api/store/logo?v=${encodeURIComponent(STORE.updated_at ?? "")}`,
    )
    expect(img).toHaveAttribute("alt", STORE.name)
  })
})
