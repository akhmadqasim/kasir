import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { useInquiryResult } from "./components/quick-access/use-inquiry-result"
import type { InquiryResult } from "./types"

const answer = (customerName: string) => ({ customerName }) as InquiryResult

describe("useInquiryResult", () => {
  it("shows the answer for the inputs it was asked about", () => {
    const { result } = renderHook(() => useInquiryResult())

    const land = result.current.accept()
    act(() => land(answer("BUDI")))

    expect(result.current.result?.customerName).toBe("BUDI")
  })

  // The cashier fixed a digit while the first inquiry was still in flight:
  // its answer belongs to the old number and must not reach the confirm card.
  it("drops an answer that arrives after the inputs changed", () => {
    const { result } = renderHook(() => useInquiryResult())

    const land = result.current.accept()
    act(() => result.current.reset())
    act(() => land(answer("ORANG LAIN")))

    expect(result.current.result).toBeNull()
  })

  it("keeps only the latest of two inquiries", () => {
    const { result } = renderHook(() => useInquiryResult())

    const first = result.current.accept()
    const second = result.current.accept()
    act(() => second(answer("BARU")))
    act(() => first(answer("LAMA")))

    expect(result.current.result?.customerName).toBe("BARU")
  })
})
