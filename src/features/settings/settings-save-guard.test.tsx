import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock, type ApiRoutes } from "@/test-utils/api-mock"
import type { User } from "@/features/auth/types"
import type { AppSettings, PrinterSettings, StoreInfo } from "./types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { DataTab } from "./components/data-tab"
import { PpobSettingsTab } from "./components/ppob-settings-tab"
import { PrinterSettingsTab } from "./components/printer-settings-tab"
import { SalesSettingsTab } from "./components/sales-settings-tab"
import { SettingsPage } from "./components/settings-page"
import { StoreInfoTab } from "./components/store-info-tab"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin Toko",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const MARKUP = {
  pulsa: { type: "fixed", value: 1000 },
  data: { type: "fixed", value: 0 },
  pln: { type: "fixed", value: 0 },
  pdam: { type: "fixed", value: 0 },
  bpjs: { type: "fixed", value: 0 },
  emoney: { type: "fixed", value: 0 },
  custom_prices: {},
} as const

/**
 * What `GET /api/settings` actually answers now.
 *
 * The PPOB password and PIN are absent, and not by omission in this fixture:
 * the endpoint stopped sending them. Only `has_credentials` remains, which says
 * whether both are stored without saying what they are.
 */
const SETTINGS: AppSettings = {
  sales: { allow_negative_stock: false, default_payment_method: "cash" },
  security: { session_timeout_minutes: 30 },
  ppob: {
    enabled: true,
    phone_number: "081234567890",
    device_id: "device-abc",
    has_credentials: true,
    markup: { ...MARKUP },
  },
  backup: { interval_hours: 3, retention_days: 90 },
}

/** The same PPOB block as `PUT /api/settings` accepts it: no `has_credentials`. */
const WRITABLE_PPOB = {
  enabled: SETTINGS.ppob.enabled,
  phone_number: SETTINGS.ppob.phone_number,
  device_id: SETTINGS.ppob.device_id,
  markup: SETTINGS.ppob.markup,
}

const PRINTER_SETTINGS: PrinterSettings = {
  printer_id: "POS-58",
  paper_width: 58,
  auto_print: true,
  footer_text: "Terima kasih",
  print_mode: "raster",
}

const STORE: StoreInfo = {
  id: 1,
  name: "Toko Sembako Maju",
  address: "Jl. Merdeka 1",
  phone: "081200000000",
  email: null,
  logo_path: null,
  additional_info: null,
  created_at: null,
  updated_at: null,
}

let api: ApiMock

/**
 * Hold one route open until the test releases it, so the window where the query
 * has not answered — the only moment a form still holds its hardcoded defaults —
 * can be observed instead of slipping past in the first microtask.
 */
function deferRoute(route: string, value: unknown, others: ApiRoutes = {}) {
  let release: () => void = () => {}
  const pending = new Promise((resolve) => {
    release = () => resolve(value)
  })
  api = installApiMock({ ...others, [route]: () => pending })
  return { release }
}

function renderTab(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function saveButtons() {
  return screen.getAllByRole("button", { name: "Simpan" })
}

beforeEach(() => {
  api = installApiMock({})
  useAuthStore.setState({ user: ADMIN })
})

/**
 * The server rewrites all four settings blocks at once. If a tab may save before
 * its query has answered, the blocks it does not own go out as defaults. A save
 * button that stays dead until the data is in is the only thing preventing it.
 *
 * The PPOB credentials are no longer among the casualties — they cannot travel
 * on this request at all — but the sales, security and backup blocks still can.
 */
describe("penjaga tombol simpan pengaturan", () => {
  it("mematikan kedua tombol simpan PPOB sampai pengaturan dimuat", async () => {
    const { release } = deferRoute("GET /settings", SETTINGS)
    renderTab(<PpobSettingsTab />)

    const buttons = saveButtons()
    expect(buttons).toHaveLength(2)
    buttons.forEach((button) => expect(button).toBeDisabled())

    release()
    await vi.waitFor(() => {
      saveButtons().forEach((button) => expect(button).toBeEnabled())
    })
  })

  it("tidak mengirim PUT /settings saat tombol PPOB masih mati", async () => {
    const { release } = deferRoute("GET /settings", SETTINGS, {
      "PUT /settings": null,
    })
    renderTab(<PpobSettingsTab />)

    fireEvent.click(saveButtons()[0])
    expect(api.callsFor("PUT /settings")).toHaveLength(0)

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings")?.body).toEqual({
        sales: SETTINGS.sales,
        security: SETTINGS.security,
        backup: SETTINGS.backup,
        ppob: WRITABLE_PPOB,
      })
    })
  })

  /**
   * The failure this replaces: the tab used to read the password back out of
   * `GET /settings`, hold it in a state field, and post it again on every save.
   * A save that ran before the query answered posted an empty one instead.
   */
  it("menyimpan PPOB tanpa menyentuh kredensial saat kolomnya dikosongkan", async () => {
    api = installApiMock({
      "GET /settings": SETTINGS,
      "PUT /settings": null,
      "PUT /settings/ppob/credentials": null,
    })
    renderTab(<PpobSettingsTab />)

    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())
    fireEvent.click(saveButtons()[0])

    await vi.waitFor(() => expect(api.callsFor("PUT /settings")).toHaveLength(1))
    expect(api.callsFor("PUT /settings/ppob/credentials")).toHaveLength(0)
  })

  it("mengirim kredensial lewat endpoint sendiri saat keduanya diisi", async () => {
    api = installApiMock({
      "GET /settings": SETTINGS,
      "PUT /settings": null,
      "PUT /settings/ppob/credentials": null,
    })
    renderTab(<PpobSettingsTab />)

    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.change(screen.getByLabelText("Password Mitra"), {
      target: { value: "rahasia-baru" },
    })
    fireEvent.change(screen.getByLabelText("PIN Transaksi"), {
      target: { value: "654321" },
    })
    fireEvent.click(saveButtons()[0])

    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings/ppob/credentials")?.body).toEqual({
        password: "rahasia-baru",
        pin: "654321",
      })
    })
    // The settings blob still cannot carry them, whatever was typed.
    expect(api.lastCall("PUT /settings")?.body).toEqual({
      sales: SETTINGS.sales,
      security: SETTINGS.security,
      backup: SETTINGS.backup,
      ppob: WRITABLE_PPOB,
    })
  })

  it("menyimpan tab Penjualan tanpa mengubah blok lain", async () => {
    const { release } = deferRoute("GET /settings", SETTINGS, {
      "PUT /settings": null,
    })
    renderTab(<SalesSettingsTab />)

    expect(saveButtons()[0]).toBeDisabled()
    expect(api.callsFor("PUT /settings")).toHaveLength(0)

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings")?.body).toMatchObject({
        ppob: WRITABLE_PPOB,
        security: SETTINGS.security,
        backup: SETTINGS.backup,
      })
    })
  })

  it("mematikan tombol simpan Printer sampai pengaturan printer dimuat", async () => {
    const { release } = deferRoute("GET /printers/settings", PRINTER_SETTINGS, {
      "GET /printers": [],
      "PUT /printers/settings": null,
    })
    renderTab(<PrinterSettingsTab />)

    fireEvent.click(saveButtons()[0])
    expect(saveButtons()[0]).toBeDisabled()
    expect(api.callsFor("PUT /printers/settings")).toHaveLength(0)

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /printers/settings")?.body).toEqual({
        printer_id: "POS-58",
        paper_width: 58,
        auto_print: true,
        footer_text: "Terima kasih",
        print_mode: "raster",
      })
    })
  })

  it("mematikan tombol simpan Toko sampai informasi toko dimuat", async () => {
    const { release } = deferRoute("GET /store", STORE, { "PUT /store": STORE })
    renderTab(<StoreInfoTab isAdmin />)

    fireEvent.click(saveButtons()[0])
    expect(saveButtons()[0]).toBeDisabled()
    expect(api.callsFor("PUT /store")).toHaveLength(0)

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /store")?.body).toEqual({
        name: STORE.name,
        address: STORE.address,
        phone: STORE.phone,
        email: null,
      })
    })
  })
})

const BACKUPS = [
  { filename: "kasir-20260905.db.gz", size_bytes: 2048, created_at: "2026-09-05 03:00:00" },
  { filename: "kasir-20260904.db.gz", size_bytes: 1024, created_at: "2026-09-04 03:00:00" },
]

const BACKUP_STATUS = {
  last_backup: BACKUPS[0],
  total_backups: BACKUPS.length,
  total_size_bytes: 3072,
  backup_dir: "C:\\kasir\\backup",
  settings: SETTINGS.backup,
}

/** The settings screen as a whole: which tabs show, and the confirmations. */
describe("layar pengaturan", () => {
  beforeEach(() => {
    api = installApiMock({
      "GET /settings": SETTINGS,
      "GET /store": STORE,
      "GET /settings/database": { size_bytes: 4096, path: "C:\\kasir\\kasir.db" },
      "GET /backups/status": BACKUP_STATUS,
      "GET /backups": BACKUPS,
      "GET /printers": [],
      "GET /printers/settings": PRINTER_SETTINGS,
      "DELETE /backups/*": null,
    })
  })

  it("membuka tab Toko lebih dulu dan menyembunyikan tab admin dari kasir", () => {
    const { unmount } = renderTab(<SettingsPage />)

    const tablist = screen.getByRole("tablist", { name: "Pengaturan" })
    expect(within(tablist).getByRole("tab", { selected: true })).toHaveTextContent("Toko")
    expect(within(tablist).getByRole("tab", { name: /Mitra Indogrosir/ })).toBeInTheDocument()
    unmount()

    useAuthStore.setState({ user: { ...ADMIN, role: "kasir" } })
    renderTab(<SettingsPage />)

    const kasirTabs = within(screen.getByRole("tablist", { name: "Pengaturan" })).getAllByRole(
      "tab",
    )
    expect(kasirTabs.map((tab) => tab.textContent)).toEqual(["Toko", "Printer"])
  })

  it("meminta konfirmasi sebelum menghapus sebuah backup", async () => {
    renderTab(<DataTab />)

    const remove = await screen.findByRole("button", {
      name: "Hapus backup kasir-20260905.db.gz",
    })
    fireEvent.click(remove)

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/kasir-20260905\.db\.gz/)).toBeInTheDocument()
    expect(api.callsFor("DELETE /backups/*")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Hapus" }))
    await vi.waitFor(() => {
      expect(api.lastCall("DELETE /backups/*")?.path).toBe("/backups/kasir-20260905.db.gz")
    })
  })

  /**
   * Import no longer takes a path the client typed. It takes a file, and the
   * confirmation names the file that is about to replace the shop's database.
   */
  it("meminta konfirmasi berisi nama berkas sebelum mengimpor database", async () => {
    api.route("POST /backups/import", "Database akan dipasang saat aplikasi dijalankan ulang")
    const { container } = renderTab(<DataTab />)

    await screen.findByRole("button", { name: /Import Database/ })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    fireEvent.change(fileInput, {
      target: { files: [new File(["SQLite format 3"], "kasir-export.db")] },
    })

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/kasir-export\.db/)).toBeInTheDocument()
    expect(api.callsFor("POST /backups/import")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Import" }))
    await vi.waitFor(() => {
      expect(api.callsFor("POST /backups/import")).toHaveLength(1)
    })
  })
})
