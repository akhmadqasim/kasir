import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import type { StoreInfo } from "@/features/settings/types"
import { queryKeys } from "@/lib/api/query-keys"

const renderIconPng = vi.fn()
vi.mock("./icon-png", () => ({ renderIconPng: (src: string) => renderIconPng(src) }))

import { useWindowIcon } from "./use-window-icon"

const STORE: StoreInfo = {
  id: 1,
  name: "Toko Maju",
  address: null,
  phone: null,
  email: null,
  logo_path: "store/logo.png",
  additional_info: null,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-09-13 10:00:00",
}

const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })

let api: ApiMock
let client: QueryClient

function Probe({ available }: { available: boolean }) {
  useWindowIcon(available)
  return null
}

function renderProbe(available = true) {
  return render(
    <QueryClientProvider client={client}>
      <Probe available={available} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  renderIconPng.mockReset().mockResolvedValue(PNG)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api = installApiMock({
    "GET /store": STORE,
    "POST /window/icon": null,
    "DELETE /window/icon": null,
  })
})

describe("useWindowIcon", () => {
  it("melukis logo toko ke ikon jendela begitu data toko tiba", async () => {
    renderProbe()

    await waitFor(() => expect(api.lastCall("POST /window/icon")).toBeDefined())
    expect(renderIconPng).toHaveBeenCalledWith(expect.stringContaining("/store/logo?v="))
    expect(api.lastCall("DELETE /window/icon")).toBeUndefined()
  })

  it("mengembalikan ikon bawaan ketika logo dihapus, tapi tidak sebelum pernah melukis", async () => {
    api.route("GET /store", { ...STORE, logo_path: null })
    renderProbe()
    await waitFor(() => expect(client.getQueryData(queryKeys.settings.store)).toBeDefined())
    // Toko tanpa logo pada jendela yang baru dibuka: tidak ada yang perlu direset.
    expect(api.lastCall("DELETE /window/icon")).toBeUndefined()

    api.route("GET /store", STORE)
    await client.refetchQueries({ queryKey: queryKeys.settings.store })
    await waitFor(() => expect(api.lastCall("POST /window/icon")).toBeDefined())

    api.route("GET /store", { ...STORE, logo_path: null })
    await client.refetchQueries({ queryKey: queryKeys.settings.store })
    await waitFor(() => expect(api.lastCall("DELETE /window/icon")).toBeDefined())
  })

  it("tidak menyentuh ikon dari klien yang bukan jendela kasir", async () => {
    renderProbe(false)
    await waitFor(() => expect(client.getQueryData(queryKeys.settings.store)).toBeDefined())

    expect(renderIconPng).not.toHaveBeenCalled()
    expect(api.lastCall("POST /window/icon")).toBeUndefined()
  })
})
