import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { formatRupiah } from "@/lib/format"

const rp = (value: number) => formatRupiah(value).replace(/\s+/g, " ")

const hookResult = {
  data: [
    { productId: 1, productName: "Beras 5kg", totalQty: 7, totalRevenue: 420_000 },
    { productId: 2, productName: "Minyak 1L", totalQty: 3, totalRevenue: 51_000 },
  ],
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
}

vi.mock("../hooks/use-dashboard", () => ({
  useTopProducts: () => hookResult,
}))

import { TopProductsTable } from "./top-products-table"

describe("TopProductsTable", () => {
  it("renders each product with its revenue", () => {
    render(<TopProductsTable />)
    expect(screen.getByText("Beras 5kg")).toBeInTheDocument()
    expect(screen.getByText("Minyak 1L")).toBeInTheDocument()
    expect(screen.getByText(rp(420_000))).toBeInTheDocument()
    expect(screen.getByText(rp(51_000))).toBeInTheDocument()
  })
})
