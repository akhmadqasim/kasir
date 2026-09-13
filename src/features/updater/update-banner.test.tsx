import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { AppUpdateCard } from "./components/app-update-card"
import { UpdateBanner } from "./components/update-banner"
import { describeStatus, isVisibleFailure } from "./lib/describe-status"
import type { UpdateStatus } from "./types"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin Toko",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const KASIR: User = { ...ADMIN, id: 2, username: "kasir", full_name: "Kasir", role: "kasir" }

const AVAILABLE: UpdateStatus = {
  current_version: "0.5.0",
  phase: "available",
  version: "0.6.0",
  notes: "Perbaikan struk PPOB.",
  published_at: "2026-09-13T02:00:00Z",
}

const DOWNLOADING: UpdateStatus = {
  current_version: "0.5.0",
  phase: "downloading",
  version: "0.6.0",
  received: 3 * 1024 * 1024,
  total: 12 * 1024 * 1024,
}

const READY: UpdateStatus = { current_version: "0.5.0", phase: "ready", version: "0.6.0" }

let api: ApiMock

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) }
}

beforeEach(() => {
  api = installApiMock({})
  useAuthStore.setState({ user: ADMIN })
})

describe("UpdateBanner", () => {
  it("menawarkan versi baru pada admin dengan tombol perbarui dan nanti", async () => {
    api = installApiMock({ "GET /updates": AVAILABLE })
    renderWithQuery(<UpdateBanner />)

    expect(await screen.findByText("Versi 0.6.0 tersedia")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Perbarui sekarang" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Nanti" })).toBeInTheDocument()
  })

  it("tidak menampilkan apa pun pada kasir", async () => {
    useAuthStore.setState({ user: KASIR })
    api = installApiMock({ "GET /updates": AVAILABLE })
    renderWithQuery(<UpdateBanner />)

    // Give the query a turn; the banner must stay absent even with data in.
    await vi.waitFor(() => expect(api.callsFor("GET /updates").length).toBeGreaterThan(0))
    expect(screen.queryByText("Versi 0.6.0 tersedia")).not.toBeInTheDocument()
  })

  it("diam saat tidak ada pembaruan dan saat pemeriksaan latar gagal", async () => {
    api = installApiMock({
      "GET /updates": {
        current_version: "0.5.0",
        phase: "failed",
        step: "check",
        message: "Tidak dapat menghubungi server pembaruan.",
      } satisfies UpdateStatus,
    })
    const { container } = renderWithQuery(<UpdateBanner />)

    await vi.waitFor(() => expect(api.callsFor("GET /updates").length).toBeGreaterThan(0))
    expect(container).toBeEmptyDOMElement()
  })

  it("menampilkan unduhan yang gagal karena seseorang memulainya", async () => {
    api = installApiMock({
      "GET /updates": {
        current_version: "0.5.0",
        phase: "failed",
        step: "download",
        message: "Unduhan terputus.",
      } satisfies UpdateStatus,
    })
    renderWithQuery(<UpdateBanner />)

    expect(await screen.findByText("Pembaruan gagal")).toBeInTheDocument()
    expect(screen.getByText("Unduhan terputus.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument()
  })

  it("mengunduh saat 'Perbarui sekarang' ditekan dan langsung menggambar progresnya", async () => {
    api = installApiMock({
      "GET /updates": AVAILABLE,
      "POST /updates/download": DOWNLOADING,
    })
    renderWithQuery(<UpdateBanner />)

    fireEvent.click(await screen.findByRole("button", { name: "Perbarui sekarang" }))

    await vi.waitFor(() => expect(api.callsFor("POST /updates/download")).toHaveLength(1))
    // The mutation's answer seeds the cache, so the progress bar shows before
    // the next poll — with the bytes as its label.
    expect(await screen.findByText("3.0 MB / 12.0 MB")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toBeInTheDocument()
  })

  it("'Nanti' menyembunyikan tawaran itu saja, bukan tahap berikutnya", async () => {
    api = installApiMock({ "GET /updates": AVAILABLE })
    const { client, container } = renderWithQuery(<UpdateBanner />)

    fireEvent.click(await screen.findByRole("button", { name: "Nanti" }))
    expect(container).toBeEmptyDOMElement()

    // The download was started elsewhere (the settings card); the offer to
    // restart is a new question and comes back.
    client.setQueryData(queryKeys.updates.status, READY)
    expect(await screen.findByText("Versi 0.6.0 siap dipasang")).toBeInTheDocument()
  })

  it("memasang hanya setelah dikonfirmasi", async () => {
    api = installApiMock({
      "GET /updates": READY,
      "POST /updates/install": { ...READY, phase: "installing" } satisfies UpdateStatus,
    })
    renderWithQuery(<UpdateBanner />)

    fireEvent.click(await screen.findByRole("button", { name: "Mulai ulang untuk menyelesaikan" }))
    expect(api.callsFor("POST /updates/install")).toHaveLength(0)

    fireEvent.click(await screen.findByRole("button", { name: "Ya, Pasang" }))
    await vi.waitFor(() => expect(api.callsFor("POST /updates/install")).toHaveLength(1))
    expect(await screen.findByText("Memasang versi 0.6.0")).toBeInTheDocument()
  })
})

describe("AppUpdateCard", () => {
  it("menampilkan versi terpasang dan memeriksa saat diminta", async () => {
    api = installApiMock({
      "GET /updates": { current_version: "0.5.0", phase: "idle" } satisfies UpdateStatus,
      "POST /updates/check": {
        current_version: "0.5.0",
        phase: "up_to_date",
      } satisfies UpdateStatus,
    })
    renderWithQuery(<AppUpdateCard />)

    expect(await screen.findByText("0.5.0")).toBeInTheDocument()
    expect(screen.getByText("Belum diperiksa")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Periksa pembaruan" }))
    expect(await screen.findByText("Aplikasi sudah versi terbaru")).toBeInTheDocument()
  })

  it("memberi kasir statusnya tanpa tombol pasang", async () => {
    useAuthStore.setState({ user: KASIR })
    api = installApiMock({ "GET /updates": AVAILABLE })
    renderWithQuery(<AppUpdateCard />)

    expect(await screen.findByText("Versi 0.6.0 tersedia")).toBeInTheDocument()
    expect(screen.getByText("Hanya admin yang dapat memasang pembaruan.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Perbarui sekarang" })).not.toBeInTheDocument()
  })
})

describe("describeStatus", () => {
  it("memberi satu kalimat untuk setiap fase", () => {
    expect(describeStatus({ current_version: "1", phase: "idle" })).toBe("Belum diperiksa")
    expect(describeStatus(AVAILABLE)).toBe("Versi 0.6.0 tersedia")
    expect(describeStatus(READY)).toBe("Versi 0.6.0 siap dipasang")
    expect(
      describeStatus({ current_version: "1", phase: "failed", step: "install", message: "X" }),
    ).toBe("X")
  })

  it("hanya menganggap kegagalan unduh dan pasang layak ditampilkan", () => {
    expect(
      isVisibleFailure({ current_version: "1", phase: "failed", step: "check", message: "" }),
    ).toBe(false)
    expect(
      isVisibleFailure({ current_version: "1", phase: "failed", step: "download", message: "" }),
    ).toBe(true)
    expect(isVisibleFailure(undefined)).toBe(false)
  })
})
