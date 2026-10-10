import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { toast } from "@/lib/toast"
import { apiFailure, installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { TransactionDetailDialog } from "./components/transaction-detail-dialog"
import type { TransactionDetail, TransactionListItem } from "./types"

const KASIR: User = {
  id: 2,
  username: "kasir01",
  full_name: "Kasir Satu",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const LISTED: TransactionListItem = {
  id: 1,
  receipt_number: "TRX-20260905-0001",
  user_id: KASIR.id,
  cashier_name: "Kasir Satu",
  total_amount: 12000,
  subtotal_amount: 12000,
  discount_amount: 0,
  payment_method: "cash",
  payment_amount: 12000,
  change_amount: 0,
  status: "completed",
  channel: "sales",
  item_count: 1,
  notes: null,
  created_at: "2026-09-05 03:00:00",
  has_refundable_goods: false,
  has_refundable_failed_ppob: false,
  ppob_service_type: null,
  ppob_advice: null,
  has_ppob: true,
  ppob_status: "failed",
  ppob_message: "Provider timeout",
  ppob_serial_number: null,
  deleted_at: null,
  deleted_reason: null,
  payment_breakdown: [{ payment_method: "cash", amount: 12000 }],
}

/** A single PPOB line whose upstream fulfilment failed — the one case that offers Retry. */
const DETAIL: TransactionDetail = {
  transaction: {
    id: 1,
    receipt_number: "TRX-20260905-0001",
    user_id: KASIR.id,
    total_amount: 12000,
    subtotal_amount: 12000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 12000,
    change_amount: 0,
    status: "completed",
    channel: "sales",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: "2026-09-05 03:00:00",
  },
  items: [
    {
      id: 10,
      transaction_id: 1,
      product_id: null,
      product_name: "Pulsa Telkomsel 10K",
      product_price: 12000,
      buy_price: 10000,
      quantity: 1,
      subtotal: 12000,
      item_discount: 0,
      net_subtotal: 12000,
      service_type: "pulsa",
      service_ref: "08123456789",
      ppob_product_id: 101,
      ppob_product_code: "TS10",
      ppob_inquiry_id: null,
      ppob_payment_code: null,
      ppob_flag_id: null,
      ppob_status: "failed",
      ppob_message: "Provider timeout",
      ppob_serial_number: null,
      created_at: "2026-09-05 03:00:00",
      refunded_quantity: 0,
      refundable: true,
      refundable_quantity: 1,
      ppob_manual_fail_opens_at: null,
    },
  ],
  cashier_name: "Kasir Satu",
  has_refundable_goods: true,
  has_refundable_failed_ppob: true,
  has_ppob: true,
  ppob_status: "failed",
  ppob_message: "Provider timeout",
  ppob_serial_number: null,
  payment_breakdown: [{ payment_method: "cash", amount: 12000 }],
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TransactionDetailDialog transaction={LISTED} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let api: ApiMock

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: KASIR })
  api = installApiMock({
    "GET /transactions/*": DETAIL,
    "POST /transaction-items/*/ppob/retry": "PPOB fulfillment sedang diproses ulang",
  })
})

/**
 * The PIN used to travel nowhere near this button — a retry just replayed
 * whatever the settings screen had stored. Now every retry asks for it again,
 * because it is never kept anywhere between attempts.
 */
describe("retry PPOB dari riwayat transaksi", () => {
  it("meminta PIN sebelum retry, bukan langsung memanggil retry", async () => {
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: /Coba Ulang PPOB/ }))

    expect(await screen.findByLabelText("PIN Mitra")).toBeInTheDocument()
    expect(api.callsFor("POST /transaction-items/*/ppob/retry")).toHaveLength(0)
  })

  it("mematikan tombol retry di dialog sampai PIN 4-6 digit terisi", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Coba Ulang PPOB/ }))
    const pinField = await screen.findByLabelText("PIN Mitra")

    const confirmButtons = screen.getAllByRole("button", { name: "Coba Ulang PPOB" })
    const confirmButton = confirmButtons[confirmButtons.length - 1]
    expect(confirmButton).toBeDisabled()

    fireEvent.change(pinField, { target: { value: "12" } })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(pinField, { target: { value: "123456" } })
    expect(confirmButton).toBeEnabled()
  })

  it("mengirim PIN yang diketik ke endpoint retry", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Coba Ulang PPOB/ }))
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "654321" } })

    const confirmButtons = screen.getAllByRole("button", { name: "Coba Ulang PPOB" })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() =>
      expect(api.callsFor("POST /transaction-items/*/ppob/retry")).toHaveLength(1),
    )
    const call = api.lastCall("POST /transaction-items/*/ppob/retry")
    expect(call?.body).toEqual({ pin: "654321" })
  })

  it("mengosongkan PIN dan menutup dialog konfirmasi setelah berhasil", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Coba Ulang PPOB/ }))
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "654321" } })

    const confirmButtons = screen.getAllByRole("button", { name: "Coba Ulang PPOB" })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(screen.queryByLabelText("PIN Mitra")).not.toBeInTheDocument())
  })
})

/** The same sale with a sack of rice rung up next to the pulsa. */
const RICE_LINE: TransactionDetail["items"][number] = {
  ...DETAIL.items[0],
  id: 11,
  product_id: 7,
  product_name: "Beras 5kg",
  service_type: null,
  service_ref: null,
  ppob_product_id: null,
  ppob_product_code: null,
  ppob_status: null,
  ppob_message: null,
}

describe("transaksi campuran barang + PPOB", () => {
  it("tetap menawarkan refund untuk barang fisiknya", async () => {
    api.route("GET /transactions/*", { ...DETAIL, items: [...DETAIL.items, RICE_LINE] })
    renderDialog()

    expect(await screen.findByRole("button", { name: /Coba Ulang PPOB/ })).toBeInTheDocument()
    // Past the refund window in this fixture, so the tooltip wrapper is a button too.
    expect(screen.getAllByRole("button", { name: /Refund/ }).length).toBeGreaterThan(0)
  })

  it("tidak menawarkan refund lagi setelah semua barangnya kembali", async () => {
    // The failed pulsa already went back too; the sale is `partial_refund`.
    api.route("GET /transactions/*", {
      ...DETAIL,
      transaction: { ...DETAIL.transaction, status: "partial_refund" },
      has_refundable_goods: false,
      has_refundable_failed_ppob: false,
      items: [
        { ...DETAIL.items[0], refunded_quantity: 1, refundable_quantity: 0 },
        { ...RICE_LINE, quantity: 2, refunded_quantity: 2, refundable_quantity: 0 },
      ],
    })
    renderDialog()

    await screen.findByRole("button", { name: /Coba Ulang PPOB/ })
    expect(screen.queryAllByRole("button", { name: /Refund/ })).toHaveLength(0)
  })

  it("menawarkan refund untuk PPOB yang gagal", async () => {
    renderDialog()

    await screen.findByRole("button", { name: /Coba Ulang PPOB/ })
    expect(screen.getAllByRole("button", { name: /Refund/ }).length).toBeGreaterThan(0)
  })

  it("menawarkan refund untuk top-up gagal yang dibeli di halaman PPOB", async () => {
    // The server refunds a failed line whatever the channel; the button must not hide it.
    api.route("GET /transactions/*", {
      ...DETAIL,
      transaction: { ...DETAIL.transaction, channel: "ppob" },
    })
    renderDialog()

    await screen.findByRole("button", { name: /Coba Ulang PPOB/ })
    expect(screen.getAllByRole("button", { name: /Refund/ }).length).toBeGreaterThan(0)
  })

  it("me-retry baris PPOB kedua yang gagal meski baris pertama berhasil", async () => {
    const succeeded = { ...DETAIL.items[0], ppob_status: "success", ppob_message: null }
    const failed = { ...DETAIL.items[0], id: 12, product_name: "Token PLN 20K" }
    api.route("GET /transactions/*", { ...DETAIL, items: [succeeded, failed] })
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: /Coba Ulang PPOB/ }))
    fireEvent.change(await screen.findByLabelText("PIN Mitra"), { target: { value: "654321" } })
    const confirmButtons = screen.getAllByRole("button", { name: "Coba Ulang PPOB" })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() =>
      expect(api.callsFor("POST /transaction-items/*/ppob/retry")).toHaveLength(1),
    )
    expect(api.lastCall("POST /transaction-items/*/ppob/retry")?.path).toBe(
      "/transaction-items/12/ppob/retry",
    )
  })
})

/** Confirm the retry dialog with a valid PIN. */
async function confirmRetry(pin = "654321") {
  fireEvent.click(await screen.findByRole("button", { name: /Coba Ulang PPOB/ }))
  fireEvent.change(await screen.findByLabelText("PIN Mitra"), { target: { value: pin } })
  const confirmButtons = screen.getAllByRole("button", { name: "Coba Ulang PPOB" })
  fireEvent.click(confirmButtons[confirmButtons.length - 1])
}

/**
 * The retry used to stop at the first refused line: every later failed purchase
 * stayed untried and the toast named only the first error.
 */
describe("coba ulang beberapa PPOB yang gagal", () => {
  const pulsa = DETAIL.items[0]
  const pln = { ...DETAIL.items[0], id: 12, product_name: "Token PLN 20K" }

  it("tetap mencoba baris berikutnya dan menyebut baris yang ditolak", async () => {
    api.route("GET /transactions/*", { ...DETAIL, items: [pulsa, pln] })
    api.route("POST /transaction-items/*/ppob/retry", (call) =>
      call.path === "/transaction-items/10/ppob/retry"
        ? apiFailure(422, "validation", "PPOB sedang diproses")
        : "PPOB fulfillment sedang diproses ulang",
    )
    renderDialog()

    await confirmRetry()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(api.callsFor("POST /transaction-items/*/ppob/retry").map((call) => call.path)).toEqual([
      "/transaction-items/10/ppob/retry",
      "/transaction-items/12/ppob/retry",
    ])
    expect(toast.success).toHaveBeenCalledWith("PPOB sedang diproses ulang di latar belakang")
    expect(toast.error).toHaveBeenCalledWith(
      "1 dari 2 PPOB gagal dicoba ulang — Pulsa Telkomsel 10K: PPOB sedang diproses",
    )
  })

  it("membiarkan dialog terbuka kalau tidak ada satu pun yang berhasil", async () => {
    api.route(
      "POST /transaction-items/*/ppob/retry",
      apiFailure(422, "validation", "PPOB sedang diproses"),
    )
    renderDialog()

    await confirmRetry()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Gagal mencoba ulang PPOB: PPOB sedang diproses"),
    )
    expect(screen.getByLabelText("PIN Mitra")).toHaveValue("654321")
    expect(toast.success).not.toHaveBeenCalled()
  })
})

/** A detail that fails to load used to leave skeleton rows up forever. */
describe("detail transaksi yang gagal dimuat", () => {
  it("menampilkan pesan gagal dan tombol coba lagi", async () => {
    api.route("GET /transactions/*", apiFailure(404, "not_found", "Transaksi tidak ditemukan"))
    renderDialog()

    expect(await screen.findByText("Gagal memuat detail transaksi")).toBeInTheDocument()
    expect(screen.getByText("Transaksi tidak ditemukan")).toBeInTheDocument()

    api.route("GET /transactions/*", DETAIL)
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }))

    expect(await screen.findByRole("button", { name: /Coba Ulang PPOB/ })).toBeInTheDocument()
  })
})

/**
 * Mitra answered `pln/payment` with ADVICE: the payment went to PLN, the token
 * comes later. The line is `uncertain` with `ppob_advice` set — it must read as
 * waiting, offer "Cek status", and offer neither a retry nor a refund.
 */
const ADVICE_DETAIL: TransactionDetail = {
  ...DETAIL,
  has_refundable_goods: false,
  ppob_status: "uncertain",
  ppob_message: "Menunggu konfirmasi biller (ADVICE)",
  items: [
    {
      ...DETAIL.items[0],
      product_name: "Token PLN 20.000",
      service_type: "pln",
      service_ref: "14203938783",
      ppob_status: "uncertain",
      ppob_message: "Menunggu konfirmasi biller (ADVICE)",
      ppob_advice: '{"advice_id":"eyJpdiI6IkEifQ=="}',
      refundable: false,
      refundable_quantity: 0,
    },
  ],
}

describe("PPOB yang dijawab ADVICE", () => {
  it("tampil menunggu konfirmasi PLN, tanpa coba ulang dan tanpa refund", async () => {
    api.route("GET /transactions/*", ADVICE_DETAIL)
    renderDialog()

    expect(await screen.findByText("Menunggu Konfirmasi PLN")).toBeInTheDocument()
    expect(screen.getByText("Menunggu konfirmasi PLN")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Cek status/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Coba Ulang PPOB/ })).not.toBeInTheDocument()
    expect(screen.queryAllByRole("button", { name: /Refund/ })).toHaveLength(0)
    expect(screen.queryByText("Gagal")).not.toBeInTheDocument()
  })

  it("Cek status menanyakan riwayat Mitra untuk baris itu", async () => {
    api.route("GET /transactions/*", ADVICE_DETAIL)
    api.route("POST /transaction-items/*/ppob/check", {
      status: "success",
      message: "Berhasil menurut riwayat Mitra. Struk bisa dicetak.",
    })
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: /Cek status/ }))

    await waitFor(() =>
      expect(api.callsFor("POST /transaction-items/*/ppob/check")).toHaveLength(1),
    )
    expect(api.lastCall("POST /transaction-items/*/ppob/check")?.path).toBe(
      "/transaction-items/10/ppob/check",
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Berhasil menurut riwayat Mitra. Struk bisa dicetak.",
      ),
    )
  })

  it("hasil yang belum pasti hanya diberitahukan, baris tetap menunggu", async () => {
    api.route("GET /transactions/*", ADVICE_DETAIL)
    api.route("POST /transaction-items/*/ppob/check", {
      status: "uncertain",
      message: "Belum ada hasil pasti: belum ada di riwayat Mitra. Coba cek lagi nanti.",
    })
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: /Cek status/ }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText("Menunggu Konfirmasi PLN")).toBeInTheDocument()
  })

  it("baris belum pasti biasa tetap berlabel Perlu Dicek dan bisa dicek", async () => {
    api.route("GET /transactions/*", {
      ...ADVICE_DETAIL,
      items: [{ ...ADVICE_DETAIL.items[0], ppob_advice: null, ppob_message: "timeout" }],
    })
    renderDialog()

    expect(await screen.findByText("Perlu Dicek")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Cek status/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Coba Ulang PPOB/ })).not.toBeInTheDocument()
  })
})
