import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, installDeferredApiMock, type ApiMock } from "@/test-utils/api-mock"
import { SETTINGS, WRITABLE_PPOB } from "@/test-utils/settings-fixture"
import type { User } from "@/features/auth/types"
import type { PrinterSettings, StoreInfo } from "./types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { DataTab } from "./components/data-tab"
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
 * The Mitra Indogrosir form itself moved to `/ppob/settings`; its guard is
 * covered in `features/ppob/ppob-settings.test.tsx`.
 */
describe("penjaga tombol simpan pengaturan", () => {
  it("menyimpan tab Penjualan tanpa mengubah blok lain", async () => {
    const deferred = installDeferredApiMock("GET /settings", SETTINGS, {
      "PUT /settings": null,
    })
    api = deferred.api
    renderTab(<SalesSettingsTab />)

    expect(saveButtons()[0]).toBeDisabled()
    expect(api.callsFor("PUT /settings")).toHaveLength(0)

    deferred.release()
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
    const deferred = installDeferredApiMock("GET /printers/settings", PRINTER_SETTINGS, {
      "GET /printers": [],
      "PUT /printers/settings": null,
    })
    api = deferred.api
    renderTab(<PrinterSettingsTab />)

    fireEvent.click(saveButtons()[0])
    expect(saveButtons()[0]).toBeDisabled()
    expect(api.callsFor("PUT /printers/settings")).toHaveLength(0)

    deferred.release()
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
    const deferred = installDeferredApiMock("GET /store", STORE, { "PUT /store": STORE })
    api = deferred.api
    renderTab(<StoreInfoTab isAdmin />)

    fireEvent.click(saveButtons()[0])
    expect(saveButtons()[0]).toBeDisabled()
    expect(api.callsFor("PUT /store")).toHaveLength(0)

    deferred.release()
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
    // Mitra Indogrosir lives on its own screen now, not here.
    expect(within(tablist).queryByRole("tab", { name: /Mitra Indogrosir/ })).toBeNull()
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Toko", "Penjualan", "Printer", "Data", "Aplikasi"])
    unmount()

    useAuthStore.setState({ user: { ...ADMIN, role: "kasir" } })
    renderTab(<SettingsPage />)

    const kasirTabs = within(screen.getByRole("tablist", { name: "Pengaturan" })).getAllByRole(
      "tab",
    )
    expect(kasirTabs.map((tab) => tab.textContent)).toEqual(["Toko", "Printer", "Aplikasi"])
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
