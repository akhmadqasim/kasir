import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PinInput } from "./pin-input"

describe("PinInput", () => {
  it("strips non-digits before calling onChange", () => {
    const onChange = vi.fn()
    render(<PinInput label="PIN" value="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "12a3" } })
    expect(onChange).toHaveBeenCalledWith("123")
  })

  it("falls back to aria-label PIN without a label", () => {
    render(<PinInput value="" onChange={vi.fn()} />)
    expect(screen.getByLabelText("PIN")).toHaveAttribute("type", "password")
  })

  it("calls onEnter when Enter is pressed", () => {
    const onEnter = vi.fn()
    render(<PinInput label="PIN" value="1234" onChange={vi.fn()} onEnter={onEnter} />)
    fireEvent.keyDown(screen.getByLabelText("PIN"), { key: "Enter" })
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it("shows the error message", () => {
    render(<PinInput label="PIN" value="" onChange={vi.fn()} errorMessage="PIN salah" />)
    expect(screen.getByText("PIN salah")).toBeInTheDocument()
  })
})
