import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: toastMock }))

import { id } from "@/i18n/id"
import { queryKeys } from "@/lib/api/query-keys"
import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { useCompleteOnboarding } from "./hooks/use-onboarding"
import type { CompleteOnboardingInput } from "./types"

const INPUT: CompleteOnboardingInput = {
  store: { name: "Toko Sembako Jaya" },
  admin: { full_name: "Budi", username: "budi", pin: "1234" },
}

const STORE = { id: 1, name: "Toko Sembako Jaya" }

function renderSubmit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(queryKeys.onboarding.status, true)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/onboarding"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  const hook = renderHook(
    () => ({ mutation: useCompleteOnboarding(), location: useLocation() }),
    { wrapper },
  )
  return { ...hook, client }
}

beforeEach(() => {
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe("completing onboarding", () => {
  it("goes to login once the store is registered", async () => {
    installApiMock({ "POST /onboarding": STORE })
    const { result, client } = renderSubmit()

    act(() => result.current.mutation.mutate(INPUT))

    await waitFor(() => expect(result.current.location.pathname).toBe("/login"))
    expect(client.getQueryData(queryKeys.onboarding.status)).toBe(false)
    expect(toastMock.success).toHaveBeenCalledWith(id.onboarding.success)
  })

  // A retry after a lost answer, or the second half of a double submit, gets
  // 409: the store is already set up. It used to leave the user on the form
  // with an error they could do nothing about.
  it("treats 409 as already set up: marks it done and goes to login", async () => {
    installApiMock({
      "POST /onboarding": apiFailure(409, "conflict", "Toko sudah diatur sebelumnya"),
    })
    const { result, client } = renderSubmit()

    act(() => result.current.mutation.mutate(INPUT))

    await waitFor(() => expect(result.current.location.pathname).toBe("/login"))
    expect(client.getQueryData(queryKeys.onboarding.status)).toBe(false)
    expect(toastMock.success).toHaveBeenCalledWith(id.onboarding.alreadyDone)
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  // TanStack runs a `mutate` call's own callbacks only for the latest call, so
  // of a double submit the call that registered the store never navigated.
  it("navigates from the call that won a double submit", async () => {
    const answers: ((response: unknown) => void)[] = []
    installApiMock({
      "POST /onboarding": () => new Promise((resolve) => answers.push(resolve)),
    })
    const { result } = renderSubmit()

    act(() => {
      result.current.mutation.mutate(INPUT)
      result.current.mutation.mutate(INPUT)
    })
    await waitFor(() => expect(answers).toHaveLength(2))

    // The first call wins; the second is still out.
    await act(async () => answers[0](STORE))

    await waitFor(() => expect(result.current.location.pathname).toBe("/login"))
  })
})
