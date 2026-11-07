import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ShortcutKey } from "./shortcut-key"

describe("ShortcutKey", () => {
  it("renders the key with a leading space for the accessible name", () => {
    const { container } = render(
      <button type="button">
        Diskon
        <ShortcutKey>F2</ShortcutKey>
      </button>,
    )
    expect(screen.getByText("F2")).toBeInTheDocument()
    expect(container.textContent).toBe("Diskon F2")
  })
})
