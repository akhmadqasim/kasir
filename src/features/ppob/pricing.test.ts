import { describe, expect, it } from "vitest"
import { calculateSellPrice, extractNominal, resolvePpobSellPrice } from "./pricing"

describe("extractNominal", () => {
  it("reads an un-dotted nominal from a product name", () => {
    expect(extractNominal("Pulsa 5000")).toBe(5000)
  })

  it("reads a dotted nominal from a product name", () => {
    expect(extractNominal("Pulsa 5.000")).toBe(5000)
  })

  it("reads a K-suffixed nominal from a product name", () => {
    expect(extractNominal("Pulsa 5K")).toBe(5000)
  })

  it("skips a quota size and reads the nominal", () => {
    expect(extractNominal("Data 1.5GB 25000")).toBe(25000)
  })

  it("reads the nominal from a provider-prefixed name", () => {
    expect(extractNominal("Pulsa Telkomsel - PULSA 10.000")).toBe(10000)
  })

  it("returns null when no plausible nominal is present", () => {
    expect(extractNominal("Pulsa Reguler")).toBeNull()
    expect(extractNominal("Pulsa 500")).toBeNull()
  })

  it("returns null for values above one million", () => {
    expect(extractNominal("Token 5.000.000")).toBeNull()
  })
})

describe("calculateSellPrice", () => {
  it("keeps the vendor cost when no markup is configured", () => {
    expect(calculateSellPrice(22500, { type: "fixed", value: 0 })).toBe(22500)
  })

  it("adds a fixed markup on top of the vendor cost", () => {
    expect(calculateSellPrice(22500, { type: "fixed", value: 1000 })).toBe(23500)
  })

  it("adds a percentage markup on top of the vendor cost", () => {
    expect(calculateSellPrice(20000, { type: "percentage", value: 5 })).toBe(21000)
  })

  it("rounds a percentage markup to whole rupiah", () => {
    // 33333 * 1.05 = 34999.65
    expect(calculateSellPrice(33333, { type: "percentage", value: 5 })).toBe(35000)
  })
})

describe("resolvePpobSellPrice", () => {
  const plnTokenName = "PLN Token Rp 20.000 - BUDI"

  it("never sells a PLN token below the vendor cost that includes the admin fee", () => {
    expect(
      resolvePpobSellPrice({
        name: plnTokenName,
        serviceType: "pln",
        vendorCost: 22500,
        markup: { type: "fixed", value: 0 },
        customPrices: {},
      }),
    ).toBe(22500)
  })

  it("applies the markup on top of the cost that includes the admin fee", () => {
    expect(
      resolvePpobSellPrice({
        name: plnTokenName,
        serviceType: "pln",
        vendorCost: 22500,
        markup: { type: "fixed", value: 1000 },
        customPrices: {},
      }),
    ).toBe(23500)
  })

  it("uses the admin custom price for an un-dotted pulsa nominal", () => {
    expect(
      resolvePpobSellPrice({
        name: "Pulsa Telkomsel - Pulsa 5000",
        serviceType: "pulsa",
        vendorCost: 5400,
        markup: { type: "fixed", value: 0 },
        customPrices: { "5000": 6000 },
      }),
    ).toBe(6000)
  })

  it("falls back to the markup when the nominal has no custom price", () => {
    expect(
      resolvePpobSellPrice({
        name: "Pulsa Telkomsel - Pulsa 5000",
        serviceType: "pulsa",
        vendorCost: 5400,
        markup: { type: "fixed", value: 1000 },
        customPrices: { "10000": 11000 },
      }),
    ).toBe(6400)
  })

  it("never sells below the vendor cost even with a lower custom price", () => {
    expect(
      resolvePpobSellPrice({
        name: "Pulsa Telkomsel - Pulsa 5000",
        serviceType: "pulsa",
        vendorCost: 5400,
        markup: { type: "fixed", value: 0 },
        customPrices: { "5000": 5000 },
      }),
    ).toBe(5400)
  })

  it("ignores custom prices for services other than pulsa", () => {
    expect(
      resolvePpobSellPrice({
        name: "E-Money 5000 - 08123456789",
        serviceType: "emoney",
        vendorCost: 6500,
        markup: { type: "fixed", value: 0 },
        customPrices: { "5000": 5500 },
      }),
    ).toBe(6500)
  })

  it("treats a missing markup config as no markup", () => {
    expect(
      resolvePpobSellPrice({
        name: "PDAM Kota - SITI",
        serviceType: "pdam",
        vendorCost: 87500,
      }),
    ).toBe(87500)
  })
})
