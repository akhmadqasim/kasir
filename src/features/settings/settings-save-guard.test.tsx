import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, installDeferredApiMock, type ApiMock } from "@/test-utils/api-mock"
import { SETTINGS, WRITABLE_PPOB } from "@/test-utils/settings-fixture"
import type { User } from "@/features/auth/types"
import type { PrinterSettings, StoreInfo } from "./types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { AutoBackupCard } from "./components/data/auto-backup-card"
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

  /**
   * Two cards share one blob. What the Data tab saved after the Penjualan tab
   * read its copy must survive a later save from Penjualan.
   */
  it("menyimpan tab Penjualan di atas pengaturan terbaru, bukan salinan lama", async () => {
    api = installApiMock({ "GET /settings": SETTINGS, "PUT /settings": null })
    renderTab(<SalesSettingsTab />)
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    const newerBackup = { interval_hours: 12, retention_days: 180 }
    api.route("GET /settings", { ...SETTINGS, backup: newerBackup })

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings")?.body).toMatchObject({
        sales: SETTINGS.sales,
        backup: newerBackup,
      })
    })
  })

  it("menyimpan Backup Otomatis di atas pengaturan terbaru, bukan salinan lama", async () => {
    api = installApiMock({ "GET /settings": SETTINGS, "PUT /settings": null })
    renderTab(<AutoBackupCard backupStatus={undefined} />)
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    const newerSales = {
      ...SETTINGS.sales,
      allow_negative_stock: !SETTINGS.sales.allow_negative_stock,
    }
    api.route("GET /settings", { ...SETTINGS, sales: newerSales })

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(api.lastCall("PUT /settings")?.body).toMatchObject({
        sales: newerSales,
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
    renderTab(<PrinterSettingsTab isAdmin />)

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

  it("Test Print hanya menyala untuk printer yang sudah disimpan", async () => {
    api = installApiMock({
      "GET /printers": [
        { id: "POS-58", name: "POS-58", printer_type: "usb", is_default: true },
        { id: "POS-80", name: "POS-80", printer_type: "usb", is_default: false },
      ],
      "GET /printers/settings": PRINTER_SETTINGS,
    })
    renderTab(<PrinterSettingsTab isAdmin />)

    const testPrint = await screen.findByRole("button", { name: /Test Print/ })
    await vi.waitFor(() => expect(testPrint).toBeEnabled())

    // Server mencetak ke printer yang tersimpan, bukan yang baru dipilih.
    fireEvent.click(screen.getByRole("button", { name: /Pilih Printer/ }))
    fireEvent.click(await screen.findByRole("option", { name: "POS-80" }))
    await vi.waitFor(() => expect(testPrint).toBeDisabled())
  })

  it("tab Printer hanya-baca untuk kasir, tanpa tombol simpan", async () => {
    api = installApiMock({ "GET /printers": [], "GET /printers/settings": PRINTER_SETTINGS })
    renderTab(<PrinterSettingsTab isAdmin={false} />)

    await screen.findByText("Hanya admin yang dapat mengubah pengaturan printer")
    expect(screen.queryByRole("button", { name: "Simpan" })).toBeNull()
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /Test Print/ })).toBeEnabled())
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

  it("memulihkan backup yang dipilih setelah dikonfirmasi", async () => {
    api.route("POST /backups/*/restore", "Backup siap dipulihkan.")
    renderTab(<DataTab />)

    fireEvent.click(
      await screen.findByRole("button", { name: "Pulihkan backup kasir-20260905.db.gz" }),
    )

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/kasir-20260905\.db\.gz/)).toBeInTheDocument()
    expect(api.callsFor("POST /backups/*/restore")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Pulihkan" }))
    await vi.waitFor(() => {
      expect(api.lastCall("POST /backups/*/restore")?.path).toBe(
        "/backups/kasir-20260905.db.gz/restore",
      )
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

/** Feedback the settings forms give instead of a dead or silent control. */
describe("umpan balik formulir pengaturan", () => {
  it("menolak email toko yang salah ketik tanpa mengirimnya", async () => {
    api = installApiMock({ "GET /store": STORE, "PUT /store": STORE })
    renderTab(<StoreInfoTab isAdmin />)

    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "toko@gmail" } })
    fireEvent.click(saveButtons()[0])

    expect(await screen.findByText("Format email tidak valid")).toBeInTheDocument()
    expect(api.callsFor("PUT /store")).toHaveLength(0)
  })

  it("tetap menampilkan printer tersimpan yang sedang tidak terdeteksi", async () => {
    api = installApiMock({ "GET /printers": [], "GET /printers/settings": PRINTER_SETTINGS })
    renderTab(<PrinterSettingsTab isAdmin />)

    expect(
      await screen.findByRole("button", { name: /POS-58 \(tidak terdeteksi\)/ }),
    ).toBeInTheDocument()
  })

  it("menampilkan interval backup di luar daftar pilihan apa adanya", async () => {
    api = installApiMock({
      "GET /settings": { ...SETTINGS, backup: { interval_hours: 4, retention_days: 90 } },
      "GET /settings/database": { size_bytes: 4096, path: "C:/kasir/kasir.db" },
      "GET /backups/status": BACKUP_STATUS,
      "GET /backups": [],
    })
    renderTab(<DataTab />)

    expect(
      await screen.findByRole("button", {
        name: /4 jam.*Interval backup otomatis|Interval backup otomatis.*4 jam/,
      }),
    ).toBeInTheDocument()
    expect(await screen.findByText("Belum ada backup")).toBeInTheDocument()
  })
})
