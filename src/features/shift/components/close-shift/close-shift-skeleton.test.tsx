import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
vi.mock("@/components/layout/subpage-header", () => ({
  SubpageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

import { CloseShiftSkeleton } from "./close-shift-skeleton"

describe("CloseShiftSkeleton", () => {
  it("announces loading and keeps the page layout", () => {
    const { container } = render(<CloseShiftSkeleton title="Tutup Shift" onBack={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Memuat ringkasan shift")
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("heading", { level: 2, name: "Detail Kasir" })).toBeInTheDocument()
    expect(screen.getByText("Transaksi")).toBeInTheDocument()
    expect(screen.getByText("Total Penjualan")).toBeInTheDocument()
    expect(screen.getByText("Saldo Aplikasi")).toBeInTheDocument()
  })
})
