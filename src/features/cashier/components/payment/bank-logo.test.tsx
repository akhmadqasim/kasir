import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"

import { BankLogo } from "./bank-logo"

describe("BankLogo", () => {
  it("renders the bank's logo image on a white tile for a known bank", () => {
    const { container } = render(<BankLogo name="BCA" />)
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img?.getAttribute("alt")).toBe("")
    expect(container.firstElementChild?.className).toContain("bg-white")
  })

  it("falls back to the Landmark icon for an unknown or missing name", () => {
    for (const name of ["Bank Karangan Kasir", undefined]) {
      const { container, unmount } = render(<BankLogo name={name} />)
      expect(container.querySelector("img")).toBeNull()
      expect(container.querySelector("svg")).not.toBeNull()
      expect(container.firstElementChild?.className).toContain("bg-default")
      unmount()
    }
  })

  it("merges a custom className", () => {
    const { container } = render(<BankLogo className="size-8" name="BRI" />)
    expect(container.firstElementChild?.className).toContain("size-8")
  })
})
