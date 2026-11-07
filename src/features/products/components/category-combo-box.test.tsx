import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { CategoryComboBox } from "./category-combo-box"

const CATEGORIES = [
  { id: 7, name: "Mie Instan" },
  { id: 9, name: "Bahan Pokok" },
]

describe("CategoryComboBox", () => {
  it("shows the selected category name", () => {
    render(<CategoryComboBox categories={CATEGORIES} value="9" onValueChange={vi.fn()} />)
    expect(screen.getByRole("combobox")).toHaveValue("Bahan Pokok")
  })

  it("shows 'Tanpa kategori' for an empty value", () => {
    render(<CategoryComboBox categories={CATEGORIES} value="" onValueChange={vi.fn()} />)
    expect(screen.getByRole("combobox")).toHaveValue("Tanpa kategori")
  })
})
