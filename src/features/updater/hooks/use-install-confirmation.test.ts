import { act, renderHook } from "@testing-library/react"
import type { UseMutationResult } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import type { ApiError } from "@/lib/api/client"
import type { UpdateStatus } from "../types"
import { useInstallConfirmation } from "./use-install-confirmation"

function fakeMutation() {
  const mutate = vi.fn()
  return { mutation: { mutate } as unknown as UseMutationResult<UpdateStatus, ApiError, void>, mutate }
}

describe("useInstallConfirmation", () => {
  it("opens with a version and closes without installing", () => {
    const { mutation, mutate } = fakeMutation()
    const { result } = renderHook(() => useInstallConfirmation(mutation))
    expect(result.current.dialogProps.version).toBeNull()
    act(() => result.current.request("2.0.0"))
    expect(result.current.dialogProps.version).toBe("2.0.0")
    act(() => result.current.dialogProps.onClose())
    expect(result.current.dialogProps.version).toBeNull()
    expect(mutate).not.toHaveBeenCalled()
  })

  it("confirm closes the dialog and runs the install", () => {
    const { mutation, mutate } = fakeMutation()
    const { result } = renderHook(() => useInstallConfirmation(mutation))
    act(() => result.current.request("2.0.0"))
    act(() => result.current.dialogProps.onConfirm())
    expect(result.current.dialogProps.version).toBeNull()
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
