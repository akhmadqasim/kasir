import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { PpobMutasi } from "./components/mutasi/ppob-mutasi"
import { PpobNotifications } from "./components/notifications/ppob-notifications"

/** Hari ini dalam format vendor `YYYY-MM-DD HH:MM:SS`, supaya lolos saringan tanggal topup. */
function todayStamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 08:00:00`
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TestNavbar>{ui}</TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  installApiMock({
    "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
    "GET /ppob/mutasi": [
      {
        id: "m-1",
        mutationType: "in",
        description: "Topup via BCA",
        amount: 500_000,
        status: "sukses",
        createdAt: todayStamp(),
        paymentMethod: "BCA",
        reference: "REF-001",
        rawData: { trxid: "m-1", total: 500000 },
      },
      {
        id: "m-2",
        mutationType: "out",
        description: "PLN Token 20.000",
        amount: 20_500,
        status: "sukses",
        createdAt: todayStamp(),
        paymentMethod: null,
        reference: null,
        rawData: { trxid: "m-2" },
      },
    ],
    "GET /ppob/notifications": {
      items: [
        {
          inboxId: "n-1",
          title: "TRANSAKSI",
          message: "Transaksi PLN berhasil",
          category: "TRANSAKSI",
          status: "unread",
          createdAt: "2026-09-12 08:00:00",
          rawData: {},
        },
        {
          inboxId: "n-2",
          title: "INFO",
          message: "Pemeliharaan sistem malam ini",
          category: "INFO",
          status: "read",
          createdAt: "2026-09-11 08:00:00",
          rawData: {},
        },
      ],
      unreadCount: 1,
      totalCount: 2,
      currentPage: 1,
      totalPages: 1,
    },
    "POST /ppob/notifications/*/read": null,
  })
})

describe("ppob mutasi", () => {
  /** Mutasi adalah tabel seperti riwayat (DESIGN.md §5.4), bukan kolom tombol. */
  it("renders the movements as a table and opens the detail dialog from a row", async () => {
    renderPage(<PpobMutasi />)

    const table = await screen.findByRole("grid", { name: "Mutasi saldo Mitra" })
    expect(table).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Nominal" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("row", { name: /Topup via BCA/ }))

    expect(await screen.findByRole("dialog", { name: "Topup Saldo" })).toBeInTheDocument()
  })
})

describe("ppob notifications", () => {
  /** Kotak masuk adalah `ListBox` beraksi, dan yang belum dibaca membawa titik. */
  it("renders the inbox as a listbox and opens a notification from its option", async () => {
    renderPage(<PpobNotifications />)

    const list = await screen.findByRole("listbox", { name: "Pemberitahuan" })
    expect(list).toBeInTheDocument()
    expect(screen.getByLabelText("Belum dibaca")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("option", { name: /Transaksi PLN berhasil/ }))

    expect(await screen.findByRole("dialog", { name: "TRANSAKSI" })).toBeInTheDocument()
  })
})
