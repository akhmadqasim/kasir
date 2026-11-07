import { describe, expect, it } from "vitest"

import { defaultSort, toSearchSort } from "./sort"

describe("defaultSort", () => {
  it("sorts stock filters by stock ascending", () => {
    expect(defaultSort("low_stock")).toEqual({ column: "stock", direction: "ascending" })
    expect(defaultSort("negative_stock")).toEqual({ column: "stock", direction: "ascending" })
  })

  it("sorts other filters newest first", () => {
    expect(defaultSort("all" as never)).toEqual({ column: "created_at", direction: "descending" })
  })
})

describe("toSearchSort", () => {
  it("maps known column and direction", () => {
    expect(toSearchSort({ column: "sell_price", direction: "descending" })).toEqual({
      sort_by: "sell_price",
      sort_order: "desc",
    })
    expect(toSearchSort({ column: "stock", direction: "ascending" })).toEqual({
      sort_by: "stock",
      sort_order: "asc",
    })
  })

  it("falls back to name for unknown columns", () => {
    expect(toSearchSort({ column: "bogus", direction: "ascending" })).toEqual({
      sort_by: "name",
      sort_order: "asc",
    })
  })
})
