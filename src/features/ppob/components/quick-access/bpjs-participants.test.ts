import { describe, expect, it } from "vitest"

import { BPJS_TYPE_OPTIONS, getBpjsDataBook, parseBpjsParticipants } from "./bpjs-participants"

describe("getBpjsDataBook", () => {
  it("prefers inquiry.data_book", () => {
    expect(getBpjsDataBook({ inquiry: { data_book: "A" }, data: { data_book: "B" } })).toBe("A")
  })

  it("falls back to data.data_book", () => {
    expect(getBpjsDataBook({ inquiry: { data_book: 1 }, data: { data_book: "B" } })).toBe("B")
  })

  it("returns empty string when missing", () => {
    expect(getBpjsDataBook(undefined)).toBe("")
    expect(getBpjsDataBook({})).toBe("")
    expect(getBpjsDataBook({ inquiry: "x", data: null })).toBe("")
  })
})

describe("parseBpjsParticipants", () => {
  it("parses multiple participants separated by headers", () => {
    const book = [
      "----- Peserta 1",
      "Nomor Peserta : 0001",
      "Nama Peserta : BUDI",
      "",
      "----- Peserta 2",
      "Nomor Peserta: 0002",
      "Nama Peserta:ANI",
    ].join("\r\n")
    expect(parseBpjsParticipants(book)).toEqual([
      { number: "0001", name: "BUDI" },
      { number: "0002", name: "ANI" },
    ])
  })

  it("fills missing fields with empty string and ignores empty values", () => {
    expect(parseBpjsParticipants("Nama Peserta : SITI\nNomor Peserta :")).toEqual([
      { number: "", name: "SITI" },
    ])
  })

  it("returns empty array for empty or irrelevant input", () => {
    expect(parseBpjsParticipants("")).toEqual([])
    expect(parseBpjsParticipants("Total : 1000\n----- Peserta 1")).toEqual([])
  })
})

describe("BPJS_TYPE_OPTIONS", () => {
  it("lists kesehatan and ketenagakerjaan", () => {
    expect(BPJS_TYPE_OPTIONS.map((o) => o.value)).toEqual(["BPJSKES", "BPJSTK"])
  })
})
