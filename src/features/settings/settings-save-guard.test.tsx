import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { User } from "@/features/auth/types"
import type { AppSettings, PrinterSettings, StoreInfo } from "./types"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

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

/** Kredensial Mitra yang tidak boleh hilang saat tab mana pun menyimpan. */
const SETTINGS: AppSettings = {
  sales: { allow_negative_stock: false, default_payment_method: "cash" },
  security: { session_timeout_minutes: 30 },
  ppob: {
    enabled: true,
    phone_number: "081234567890",
    password: "rahasia",
    device_id: "device-abc",
    pin: "123456",
    markup: {
      pulsa: { type: "fixed", value: 1000 },
      data: { type: "fixed", value: 0 },
      pln: { type: "fixed", value: 0 },
      pdam: { type: "fixed", value: 0 },
      bpjs: { type: "fixed", value: 0 },
      emoney: { type: "fixed", value: 0 },
      custom_prices: {},
    },
  },
  backup: { interval_hours: 3, retention_days: 90 },
}

const PRINTER_SETTINGS: PrinterSettings = {
  printer_id: "POS-58",
  paper_width: 58,
  auto_print: true,
  footer_text: "Terima kasih",
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

/**
 * Gantung satu perintah sampai test melepasnya, supaya jendela "query belum
 * selesai" — satu-satunya saat form masih berisi default hardcoded — bisa
 * diamati, bukan lewat begitu saja di microtask pertama.
 */
function deferCommand(
  command: string,
  value: unknown,
  others: (command: string) => unknown = () => null
) {
  let release: () => void = () => {}
  const pending = new Promise((resolve) => {
    release = () => resolve(value)
  })
  invoke.mockImplementation((requested: string) =>
    requested === command ? pending : Promise.resolve(others(requested))
  )
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
  invoke.mockReset()
  useAuthStore.setState({ user: ADMIN })
})

/**
 * Backend menulis ulang keempat blok pengaturan sekaligus. Kalau sebuah tab boleh
 * menyimpan sebelum querynya selesai, blok yang tidak dimilikinya ikut terkirim
 * sebagai default — kredensial Mitra Indogrosir hilang tanpa jejak. Tombol simpan
 * yang mati sampai data masuk adalah satu-satunya yang mencegahnya.
 */
describe("penjaga tombol simpan pengaturan", () => {
  it("mematikan kedua tombol simpan PPOB sampai pengaturan dimuat", async () => {
    const { release } = deferCommand("get_app_settings", SETTINGS)
    renderTab(<PpobSettingsTab />)

    const buttons = saveButtons()
    expect(buttons).toHaveLength(2)
    buttons.forEach((button) => expect(button).toBeDisabled())

    release()
    await vi.waitFor(() => {
      saveButtons().forEach((button) => expect(button).toBeEnabled())
    })
  })

  it("tidak mengirim update_app_settings saat tombol PPOB masih mati", async () => {
    const { release } = deferCommand("get_app_settings", SETTINGS)
    renderTab(<PpobSettingsTab />)

    fireEvent.click(saveButtons()[0])
    expect(invoke).not.toHaveBeenCalledWith("update_app_settings", expect.anything())

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_app_settings", {
        settings: {
          sales: SETTINGS.sales,
          security: SETTINGS.security,
          backup: SETTINGS.backup,
          ppob: SETTINGS.ppob,
        },
        callerId: 1,
      })
    })
  })

  it("menyimpan tab Penjualan tanpa menghapus kredensial PPOB", async () => {
    const { release } = deferCommand("get_app_settings", SETTINGS)
    renderTab(<SalesSettingsTab />)

    expect(saveButtons()[0]).toBeDisabled()
    expect(invoke).not.toHaveBeenCalledWith("update_app_settings", expect.anything())

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_app_settings", {
        settings: expect.objectContaining({
          ppob: SETTINGS.ppob,
          security: SETTINGS.security,
          backup: SETTINGS.backup,
        }),
        callerId: 1,
      })
    })
  })

  it("mematikan tombol simpan Printer sampai pengaturan printer dimuat", async () => {
    const { release } = deferCommand("get_printer_settings_cmd", PRINTER_SETTINGS, (command) =>
      command === "list_printers" ? [] : null
    )
    renderTab(<PrinterSettingsTab />)

    fireEvent.click(saveButtons()[0])
    expect(saveButtons()[0]).toBeDisabled()
    expect(invoke).not.toHaveBeenCalledWith("update_printer_settings", expect.anything())

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_printer_settings", {
        input: {
          printer_id: "POS-58",
          paper_width: 58,
          auto_print: true,
          footer_text: "Terima kasih",
        },
      })
    })
  })

  it("mematikan tombol simpan Toko sampai informasi toko dimuat", async () => {
    const { release } = deferCommand("get_store_info", STORE)
    renderTab(<StoreInfoTab isAdmin />)

    fireEvent.click(saveButtons()[0])
    expect(saveButtons()[0]).toBeDisabled()
    expect(invoke).not.toHaveBeenCalledWith("update_store_info", expect.anything())

    release()
    await vi.waitFor(() => expect(saveButtons()[0]).toBeEnabled())

    fireEvent.click(saveButtons()[0])
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_store_info", {
        name: STORE.name,
        address: STORE.address,
        phone: STORE.phone,
        email: null,
        callerId: 1,
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

/** Layar pengaturan sebagai satu kesatuan: tab mana yang terlihat, dan konfirmasi. */
describe("layar pengaturan", () => {
  beforeEach(() => {
    invoke.mockImplementation((command: string) => {
      if (command === "get_app_settings") return Promise.resolve(SETTINGS)
      if (command === "get_store_info") return Promise.resolve(STORE)
      if (command === "get_database_info")
        return Promise.resolve({ size_bytes: 4096, path: "C:\\kasir\\kasir.db" })
      if (command === "get_backup_status") return Promise.resolve(BACKUP_STATUS)
      if (command === "list_backups") return Promise.resolve(BACKUPS)
      return Promise.resolve(null)
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

    const kasirTabs = within(
      screen.getByRole("tablist", { name: "Pengaturan" })
    ).getAllByRole("tab")
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
    expect(invoke).not.toHaveBeenCalledWith("delete_backup", expect.anything())

    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Hapus" }))
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_backup", {
        filename: "kasir-20260905.db.gz",
        callerId: 1,
      })
    })
  })
})
