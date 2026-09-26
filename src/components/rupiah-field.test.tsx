import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { RupiahField } from "./rupiah-field"

/** Feeds the text one keystroke at a time, the caret at the end as on the till. */
function typeInto(input: HTMLElement, text: string) {
  for (const char of text) {
    fireEvent.change(input, { target: { value: (input as HTMLInputElement).value + char } })
  }
}

function Harness({ allowNegative, isRequired }: { allowNegative?: boolean; isRequired?: boolean }) {
  const [value, setValue] = useState<number | null>(null)
  return (
    <>
      <RupiahField
        isRequired={isRequired}
        label="Biaya layanan"
        value={value}
        onChange={setValue}
        allowNegative={allowNegative}
      />
      <output>{String(value)}</output>
    </>
  )
}

describe("RupiahField", () => {
  it("groups thousands as they are typed", () => {
    render(<Harness />)
    typeInto(screen.getByLabelText("Biaya layanan"), "10000")

    expect(screen.getByLabelText("Biaya layanan")).toHaveValue("10.000")
    expect(screen.getByRole("status")).toHaveTextContent("10000")
  })

  it("keeps a leading minus typed into an empty field", () => {
    render(<Harness allowNegative />)
    typeInto(screen.getByLabelText("Biaya layanan"), "-5000")

    expect(screen.getByLabelText("Biaya layanan")).toHaveValue("-5.000")
    expect(screen.getByRole("status")).toHaveTextContent("-5000")
  })

  it("ignores the minus when negatives are not allowed", () => {
    render(<Harness />)
    typeInto(screen.getByLabelText("Biaya layanan"), "-5000")

    expect(screen.getByRole("status")).toHaveTextContent("5000")
    expect(screen.getByLabelText("Biaya layanan")).toHaveValue("5.000")
  })

  // Harga produk dulu menulis " *" ke labelnya karena kolom ini tidak punya
  // `isRequired`: pembaca layar mengucapkan "bintang", dan input-nya sendiri
  // tidak pernah ditandai wajib.
  it("marks the input required through isRequired, the label left as written", () => {
    render(<Harness isRequired />)

    expect(screen.getByLabelText("Biaya layanan")).toBeRequired()
  })

  it("is optional unless asked", () => {
    render(<Harness />)

    expect(screen.getByLabelText("Biaya layanan")).not.toBeRequired()
  })
})
