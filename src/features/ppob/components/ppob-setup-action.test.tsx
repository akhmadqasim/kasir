import { afterEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useAuthStore } from "@/features/auth"
import { PpobSetupAction } from "./ppob-setup-action"

type User = NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>
const asUser = (role: "admin" | "kasir") => ({ id: 1, username: "u", fullName: "U", role }) as unknown as User
const notConfigured = new Error("PPOB belum dikonfigurasi: isi nomor")

function renderAt(path: string, error: unknown) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PpobSetupAction error={error} />
    </MemoryRouter>,
  )
}

afterEach(() => useAuthStore.setState({ user: null }))

describe("PpobSetupAction", () => {
  it("shows the button for an admin on /ppob with a not-configured error", () => {
    useAuthStore.setState({ user: asUser("admin") })
    renderAt("/ppob/pln", notConfigured)
    expect(screen.getByRole("button", { name: /Atur Mitra/ })).toBeTruthy()
  })

  it("hides for kasir", () => {
    useAuthStore.setState({ user: asUser("kasir") })
    renderAt("/ppob/pln", notConfigured)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("hides outside /ppob", () => {
    useAuthStore.setState({ user: asUser("admin") })
    renderAt("/cashier", notConfigured)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("hides for other errors", () => {
    useAuthStore.setState({ user: asUser("admin") })
    renderAt("/ppob", new Error("Jaringan gagal"))
    expect(screen.queryByRole("button")).toBeNull()
  })
})
