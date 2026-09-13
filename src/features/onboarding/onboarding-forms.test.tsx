import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StoreInfoForm } from "./components/store-info-form"
import { AdminSetupForm } from "./components/admin-setup-form"

/**
 * Kedua langkah onboarding memvalidasi sendiri lalu memanggil callback-nya.
 * Test ini menjaga kontrak itu setelah pindah ke HeroUI: React Aria memblokir
 * submit berikutnya kalau sebuah field invalid dibiarkan memakai validasi
 * native, jadi form harus tetap bisa dikirim ulang setelah error diperbaiki.
 */
describe("onboarding forms", () => {
  it("renders the store step and validates the required name", () => {
    const onNext = vi.fn()
    render(<StoreInfoForm onNext={onNext} />)
    expect(screen.getByRole("heading", { name: "Informasi Toko" })).toBeInTheDocument()
    const name = screen.getByLabelText(/Nama Toko/)
    expect(name).toHaveAttribute("placeholder", "Contoh: Toko Sembako Jaya")
    fireEvent.click(screen.getByRole("button", { name: "Selanjutnya" }))
    expect(onNext).not.toHaveBeenCalled()
    expect(screen.getByText("Nama Toko wajib diisi")).toBeInTheDocument()
    fireEvent.change(name, { target: { value: "Toko A" } })
    fireEvent.click(screen.getByRole("button", { name: "Selanjutnya" }))
    expect(onNext).toHaveBeenCalledWith({
      name: "Toko A",
      address: undefined,
      phone: undefined,
      email: undefined,
    })
  })

  it("marks the step the user is on in the stepper", () => {
    const { unmount } = render(<StoreInfoForm onNext={vi.fn()} />)
    const store = screen.getByRole("listitem", { current: "step" })
    expect(store).toHaveTextContent("Informasi Toko")
    unmount()

    render(<AdminSetupForm isLoading={false} onBack={vi.fn()} onSubmit={vi.fn()} />)
    const admin = screen.getByRole("listitem", { current: "step" })
    expect(admin).toHaveTextContent("Akun Admin")
  })

  it("keeps the PIN numeric and reports mismatches", () => {
    const onSubmit = vi.fn()
    render(<AdminSetupForm isLoading={false} onBack={vi.fn()} onSubmit={onSubmit} />)
    const pin = screen.getByLabelText(/^PIN/)
    fireEvent.change(pin, { target: { value: "12a34" } })
    expect(pin).toHaveValue("1234")
    expect(pin).toHaveAttribute("type", "password")
    expect(pin).toHaveAttribute("inputmode", "numeric")
    fireEvent.change(screen.getByLabelText(/Nama Lengkap/), {
      target: { value: "Budi" },
    })
    fireEvent.change(screen.getByLabelText(/Username/), {
      target: { value: "budi" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Daftarkan Toko" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("PIN tidak cocok")).toBeInTheDocument()
  })
})
