import { beforeEach, describe, expect, it } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { installApiMock } from "@/test-utils/api-mock"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore, type HeldCart } from "@/stores/cart-store"
import { useAuthStore } from "./hooks/use-auth-store"
// Importing the module installs the till hand-over on the auth store.
import { useLogout } from "./hooks/use-auth"
import type { User } from "./types"

/**
 * Whoever the auth store next holds claims the till: at login and at the boot
 * `/auth/me` alike. These drive the store directly, the way both paths do.
 */

function user(id: number): User {
  return {
    id,
    username: `kasir${id}`,
    full_name: `Kasir ${id}`,
    role: "kasir",
    is_active: true,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  }
}

const LINE = {
  cart_id: "product-7",
  product_id: 7,
  product_name: "Beras 5kg",
  product_price: 68000,
  quantity: 1,
  stock: 10,
  unit: "pcs",
}

const HELD: HeldCart = {
  id: "hold-1",
  label: "Bu Sri",
  items: [LINE],
  itemDiscounts: {},
  transactionDiscount: null,
  heldAt: 0,
}

function leaveCartFor(ownerId: number | null) {
  useCartStore.setState({
    items: [LINE],
    heldCarts: [HELD],
    itemDiscounts: { "product-7": { type: "fixed", value: 500 } },
    transactionDiscount: { type: "fixed", value: 1000 },
    checkoutKey: "kunci-lama",
    ownerId,
  })
  useShiftStore.setState({ activeShift: { id: 9 } as never })
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isResolved: false })
})

describe("the till changes hands", () => {
  it("empties another cashier's cart when the boot /auth/me answers with someone else", () => {
    leaveCartFor(1)

    act(() => useAuthStore.getState().setUser(user(2)))

    const cart = useCartStore.getState()
    expect(cart.items).toEqual([])
    expect(cart.itemDiscounts).toEqual({})
    expect(cart.transactionDiscount).toBeNull()
    expect(cart.checkoutKey).toBeNull()
    expect(cart.ownerId).toBe(2)
    expect(useShiftStore.getState().activeShift).toBeNull()
  })

  it("leaves the held carts waiting for whoever serves them", () => {
    leaveCartFor(1)

    act(() => useAuthStore.getState().setUser(user(2)))

    expect(useCartStore.getState().heldCarts).toEqual([HELD])
  })

  it("empties the cart when one cashier replaces another without a logout in between", () => {
    leaveCartFor(1)
    act(() => useAuthStore.getState().setUser(user(1)))
    expect(useCartStore.getState().items).toHaveLength(1)

    act(() => useAuthStore.getState().setUser(user(2)))

    expect(useCartStore.getState().items).toEqual([])
    expect(useShiftStore.getState().activeShift).toBeNull()
  })

  it("keeps the cart, key and shift for the same cashier after a session expiry", () => {
    leaveCartFor(1)
    act(() => useAuthStore.getState().setUser(user(1)))

    // A 401 drops the cached user; the same cashier logs back in.
    act(() => useAuthStore.getState().clearUser())
    act(() => useAuthStore.getState().setUser(user(1)))

    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().checkoutKey).toBe("kunci-lama")
    expect(useShiftStore.getState().activeShift).toEqual({ id: 9 })
  })

  it("does not treat a refreshed copy of the same user as a new cashier", () => {
    leaveCartFor(1)
    act(() => useAuthStore.getState().setUser(user(1)))

    act(() => useAuthStore.getState().setUser({ ...user(1), full_name: "Nama Baru" }))

    expect(useCartStore.getState().items).toHaveLength(1)
  })

  it("lets the first user adopt a cart saved before owners were recorded, then guards it", () => {
    leaveCartFor(null)

    act(() => useAuthStore.getState().setUser(user(1)))
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().ownerId).toBe(1)

    act(() => useAuthStore.getState().clearUser())
    act(() => useAuthStore.getState().setUser(user(3)))
    expect(useCartStore.getState().items).toEqual([])
  })
})

describe("logout", () => {
  it("empties the active cart and the shift, even when the server call fails", async () => {
    installApiMock({
      "POST /auth/logout": { status: 401, code: "auth", message: "Sesi berakhir" },
    })
    leaveCartFor(1)
    act(() => useAuthStore.getState().setUser(user(1)))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useLogout(), { wrapper })

    act(() => result.current.mutate())

    await waitFor(() => expect(useAuthStore.getState().user).toBeNull())
    expect(useCartStore.getState().items).toEqual([])
    expect(useCartStore.getState().checkoutKey).toBeNull()
    expect(useShiftStore.getState().activeShift).toBeNull()
    // Customers still waiting are not the logged-out cashier's to throw away.
    expect(useCartStore.getState().heldCarts).toEqual([HELD])
  })
})
