import { describe, expect, it } from "vitest"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { markupItem } from "./markup-item"

describe("markupItem", () => {
  it("builds a success-toned markup row from the price difference", () => {
    expect(markupItem(12500, 10000)).toEqual({
      label: id.ppob.quickAccess.markup,
      value: `+${formatRupiah(2500)}`,
      tone: "success",
    })
  })

  it("shows zero markup when prices are equal", () => {
    expect(markupItem(5000, 5000).value).toBe(`+${formatRupiah(0)}`)
  })
})
