import { describe, expect, it } from "vitest"
import {
  getProductSearchEnterAction,
  isBarcodeScannerCandidate,
  isLikelyBarcodeScannerInput,
  rankProductsForSearch,
} from "./search-behavior"

describe("cashier product search behavior", () => {
  it("keeps scanner-friendly exact lookup while search results are not ready", () => {
    expect(
      getProductSearchEnterAction({
        query: "899999",
        debouncedQuery: "",
        resultCount: 0,
        hasSearchData: false,
      }),
    ).toBe("lookup-exact-barcode")
  })

  it("lets manual partial barcode select the top search result", () => {
    expect(
      getProductSearchEnterAction({
        query: "899999",
        debouncedQuery: "899999",
        resultCount: 2,
        hasSearchData: true,
      }),
    ).toBe("select-active-result")
  })

  it("waits for search when a text query has not debounced yet", () => {
    expect(
      getProductSearchEnterAction({
        query: "gula",
        debouncedQuery: "",
        resultCount: 0,
        hasSearchData: false,
      }),
    ).toBe("wait-for-search")
  })

  it("shows not found only after current text search has loaded empty", () => {
    expect(
      getProductSearchEnterAction({
        query: "produk hilang",
        debouncedQuery: "produk hilang",
        resultCount: 0,
        hasSearchData: true,
      }),
    ).toBe("show-not-found")
  })

  it("treats short numeric input as search text, not scanner input", () => {
    expect(isBarcodeScannerCandidate("899")).toBe(false)
  })

  it("detects fast barcode scanner input", () => {
    expect(
      isLikelyBarcodeScannerInput({
        query: "8991234567890",
        startedAt: 1_000,
        lastInputAt: 1_120,
        submittedAt: 1_150,
      }),
    ).toBe(true)
  })

  it("does not treat slow manual barcode typing as scanner input", () => {
    expect(
      isLikelyBarcodeScannerInput({
        query: "899123",
        startedAt: 1_000,
        lastInputAt: 1_900,
        submittedAt: 2_100,
      }),
    ).toBe(false)
  })

  it("prioritizes barcode matches over name matches", () => {
    const products = [
      { id: 1, name: "899 Snack", barcode: "111111", sku: null },
      { id: 2, name: "Minyak Goreng", barcode: "8991234567890", sku: null },
      { id: 3, name: "Beras Premium", barcode: "0089912345", sku: null },
    ]

    expect(rankProductsForSearch(products, "899").map((product) => product.id)).toEqual([2, 3, 1])
  })
})
