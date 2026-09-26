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
    expect(screen.getByText("Nama toko wajib diisi")).toBeInTheDocument()
    fireEvent.change(name, { target: { value: "Toko A" } })
    fireEvent.click(screen.getByRole("button", { name: "Selanjutnya" }))
    expect(onNext).toHaveBeenCalledWith({
      name: "Toko A",
      address: undefined,
      phone: undefined,
      email: undefined,
    })
  })

  it("rejects a malformed email and focuses the field that needs fixing", () => {
    const onNext = vi.fn()
    render(<StoreInfoForm onNext={onNext} initialData={{ name: "Toko A" }} />)
    const email = screen.getByLabelText(/Email/)
    fireEvent.change(email, { target: { value: "toko-a" } })
    fireEvent.click(screen.getByRole("button", { name: "Selanjutnya" }))
    expect(onNext).not.toHaveBeenCalled()
    expect(screen.getByText("Format email tidak valid")).toBeInTheDocument()
    expect(email).toHaveFocus()

    // Editing the field clears its message straight away.
    fireEvent.change(email, { target: { value: "toko@a.id" } })
    expect(screen.queryByText("Format email tidak valid")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Selanjutnya" }))
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ email: "toko@a.id" }))
  })

  it("does not submit the admin step twice while registration is running", () => {
    const onSubmit = vi.fn()
    render(
      <AdminSetupForm
        initialData={{ full_name: "Budi", username: "budi", pin: "1234" }}
        isLoading
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    const confirm = screen.getByLabelText(/Konfirmasi PIN/)
    fireEvent.change(confirm, { target: { value: "1234" } })
    // Enter in a field submits the form even though the button shows a spinner.
    fireEvent.submit(confirm.closest("form")!)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Kembali" })).toBeDisabled()
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
    fireEvent.change(screen.getByLabelText(/Nama Pengguna/), {
      target: { value: "budi" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Daftarkan Toko" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("PIN tidak cocok")).toBeInTheDocument()
  })

  it("asks for the PIN confirmation again after coming back to the step", () => {
    const onSubmit = vi.fn()
    render(
      <AdminSetupForm
        initialData={{ full_name: "Budi", username: "budi", pin: "1234" }}
        isLoading={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Daftarkan Toko" }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("PIN tidak cocok")).toBeInTheDocument()
  })
})
