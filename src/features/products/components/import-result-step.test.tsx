import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"

import { id } from "@/i18n/id"
import type { BulkImportResult } from "../types"
import { ImportResultStep } from "./import-result-step"

function result(over: Partial<BulkImportResult>): BulkImportResult {
  return { imported: 0, updated: 0, skipped: 0, errors: [], ...over } as BulkImportResult
}

describe("ImportResultStep", () => {
  it("shows the done title and counts for a clean import", () => {
    render(<ImportResultStep result={result({ imported: 3, updated: 2, skipped: 1 })} />)
    expect(screen.getByText(id.products.importDone)).toBeInTheDocument()
    expect(screen.getByText(/3 ditambahkan, 2 diperbarui,\s*1 dilewati/)).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Daftar peringatan import" })).toBeNull()
  })

  it("shows the nothing-imported title when no rows landed", () => {
    render(<ImportResultStep result={result({ skipped: 4 })} />)
    expect(screen.getByText(id.products.importNothingImported)).toBeInTheDocument()
    expect(screen.queryByText(id.products.importDone)).toBeNull()
  })

  it("lists every warning", () => {
    render(<ImportResultStep result={result({ imported: 1, errors: ["Baris 2: harga kosong", "Baris 5: duplikat"] })} />)
    expect(screen.getByText("Peringatan (2)")).toBeInTheDocument()
    const list = screen.getByRole("list", { name: "Daftar peringatan import" })
    const items = within(list).getAllByRole("listitem")
    expect(items.map((li) => li.textContent)).toEqual(["Baris 2: harga kosong", "Baris 5: duplikat"])
  })
})
