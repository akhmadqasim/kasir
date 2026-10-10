import { describe, expect, it } from "vitest"

import { formatRupiah } from "@/lib/format"
import { buildPpConfirmItems } from "./components/pp/pp-confirm-items"
import { getBpjsDataBook, parseBpjsParticipants } from "./components/quick-access/bpjs-participants"
import { markupItem } from "./components/quick-access/markup-item"
import type { InquiryResult, PpSubMenuItem } from "./types"

const MERCHANT: PpSubMenuItem = {
  id: 1,
  paymentPointGroupId: 2,
  plu: "PLU1",
  igrPlu: "IGR1",
  merchant: "PDAM Kota",
  description: "",
  inputAmt: 0,
  isTrouble: 0,
  label: "No. Pelanggan",
  pathIcon: null,
}

function inquiry(overrides: Partial<InquiryResult> = {}): InquiryResult {
  return {
    inquiryId: "INQ1",
    customerName: "BUDI",
    customerId: "123",
    productName: null,
    amount: 50000,
    adminFee: 2500,
    total: 52500,
    serviceType: "pdam",
    rawData: {},
    ...overrides,
  }
}

function labels(items: { label: string }[]) {
  return items.map((item) => item.label)
}

describe("buildPpConfirmItems", () => {
  it("lists bill, admin fee, markup and the total the customer pays", () => {
    const items = buildPpConfirmItems({
      groupName: "Air",
      merchant: MERCHANT,
      paymentCode: "123",
      inquiry: inquiry(),
      vendorCost: 52500,
      sellPrice: 54000,
    })

    expect(labels(items)).toEqual([
      "Pilih Kategori",
      "Pilih Merchant",
      "No. Pelanggan",
      "Nama",
      "Tagihan",
      "Admin",
      "Markup",
      "Total Bayar",
    ])
    expect(items.find((item) => item.label === "Markup")?.value).toBe(`+${formatRupiah(1500)}`)
    expect(items.at(-1)).toMatchObject({ value: formatRupiah(54000), tone: "strong" })
  })

  it("drops the admin and markup rows when there is nothing to show", () => {
    const items = buildPpConfirmItems({
      groupName: undefined,
      merchant: { ...MERCHANT, label: "" },
      paymentCode: "123",
      inquiry: inquiry({ adminFee: 0, customerName: null }),
      vendorCost: 50000,
      sellPrice: 50000,
    })

    expect(labels(items)).not.toContain("Admin")
    expect(labels(items)).not.toContain("Markup")
    expect(items[0].value).toBe("-")
    expect(items[2].label).toBe("Kode Pembayaran")
    expect(items.find((item) => item.label === "Nama")?.value).toBe("-")
  })

  it("shows the billing period from the raw answer, top level or nested", () => {
    const top = buildPpConfirmItems({
      groupName: "Air",
      merchant: MERCHANT,
      paymentCode: "1",
      inquiry: inquiry({ rawData: { periode: "SEP 2026" } }),
      vendorCost: 52500,
      sellPrice: 52500,
    })
    expect(top.find((item) => item.label === "Periode")?.value).toBe("SEP 2026")

    const nested = buildPpConfirmItems({
      groupName: "Air",
      merchant: MERCHANT,
      paymentCode: "1",
      inquiry: inquiry({ rawData: { data: { period: 202609 } } }),
      vendorCost: 52500,
      sellPrice: 52500,
    })
    expect(nested.find((item) => item.label === "Periode")?.value).toBe("202609")
  })

  it("leaves the period out when the biller sends a blank one", () => {
    const items = buildPpConfirmItems({
      groupName: "Air",
      merchant: MERCHANT,
      paymentCode: "1",
      inquiry: inquiry({ rawData: { period: "  " } }),
      vendorCost: 52500,
      sellPrice: 52500,
    })
    expect(labels(items)).not.toContain("Periode")
  })
})

describe("markupItem", () => {
  it("shows the profit over the vendor cost as a signed rupiah amount", () => {
    expect(markupItem(12000, 10500)).toEqual({
      label: "Markup",
      value: `+${formatRupiah(1500)}`,
      tone: "success",
    })
  })
})

describe("getBpjsDataBook", () => {
  it("reads the participant book from either place the upstream puts it", () => {
    expect(getBpjsDataBook({ inquiry: { data_book: "A" } })).toBe("A")
    expect(getBpjsDataBook({ data: { data_book: "B" } })).toBe("B")
    expect(getBpjsDataBook({ data: { data_book: 5 } })).toBe("")
    expect(getBpjsDataBook(undefined)).toBe("")
  })
})

describe("parseBpjsParticipants", () => {
  it("splits the book into one participant per block", () => {
    const book = [
      "----- Peserta 1 -----",
      "Nomor Peserta : 0001234567890",
      "Nama Peserta : BUDI SANTOSO",
      "----- Peserta 2 -----",
      "Nomor Peserta: 0001234567891",
      "Nama Peserta:SITI AMINAH",
      "Premi : 150.000",
    ].join("\r\n")

    expect(parseBpjsParticipants(book)).toEqual([
      { number: "0001234567890", name: "BUDI SANTOSO" },
      { number: "0001234567891", name: "SITI AMINAH" },
    ])
  })

  it("keeps a participant whose name is missing", () => {
    expect(parseBpjsParticipants("Nomor Peserta : 0009")).toEqual([{ number: "0009", name: "" }])
  })

  it("returns nobody for an empty book", () => {
    expect(parseBpjsParticipants("")).toEqual([])
    expect(parseBpjsParticipants("----- Peserta 1 -----\n")).toEqual([])
  })
})
