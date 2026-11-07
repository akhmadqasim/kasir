import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { ImportUploadStep } from "./import-upload-step"

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input")
  return input
}

const CSV = new File(["name\n"], "produk.csv", { type: "text/csv" })

describe("ImportUploadStep", () => {
  it("passes a picked file to onFile", () => {
    const onFile = vi.fn()
    const { container } = render(<ImportUploadStep isReading={false} onFile={onFile} />)
    fireEvent.change(fileInput(container), { target: { files: [CSV] } })
    expect(onFile).toHaveBeenCalledWith(CSV)
  })

  it("passes a dropped file to onFile", () => {
    const onFile = vi.fn()
    render(<ImportUploadStep isReading={false} onFile={onFile} />)
    const label = screen.getByText("Klik untuk memilih file").closest("label")!
    fireEvent.drop(label, { dataTransfer: { files: [CSV] } })
    expect(onFile).toHaveBeenCalledWith(CSV)
  })

  it("refuses drops and disables the input while reading", () => {
    const onFile = vi.fn()
    const { container } = render(<ImportUploadStep isReading onFile={onFile} />)
    expect(screen.getByText("Membaca file…")).toBeInTheDocument()
    expect(fileInput(container)).toBeDisabled()
    const label = screen.getByText("Membaca file…").closest("label")!
    fireEvent.drop(label, { dataTransfer: { files: [CSV] } })
    expect(onFile).not.toHaveBeenCalled()
  })
})
