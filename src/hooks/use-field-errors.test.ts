import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { useFieldErrors } from "./use-field-errors"

describe("useFieldErrors", () => {
  it("drops one field's message when that field is edited, leaving the others", () => {
    const { result } = renderHook(() => useFieldErrors<"name" | "price">())

    act(() => result.current.setErrors({ name: "Nama wajib diisi", price: "Harga harus > 0" }))
    act(() => result.current.clearError("name"))

    expect(result.current.errors).toEqual({ price: "Harga harus > 0" })
  })

  it("keeps the same errors object when the field had no message", () => {
    const { result } = renderHook(() => useFieldErrors<"name" | "price">())
    act(() => result.current.setErrors({ price: "Harga harus > 0" }))
    const before = result.current.errors

    act(() => result.current.clearError("name"))

    expect(result.current.errors).toBe(before)
  })

  it("wraps a setter so editing sets the value and clears the message", () => {
    const { result } = renderHook(() => useFieldErrors<"name">())
    const values: string[] = []
    act(() => result.current.setErrors({ name: "Nama wajib diisi" }))

    act(() => result.current.edit("name", (value: string) => values.push(value))("Beras"))

    expect(values).toEqual(["Beras"])
    expect(result.current.errors).toEqual({})
  })
})
