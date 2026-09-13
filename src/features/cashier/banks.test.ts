import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { BANK_LOGOS, BANKS } from "./banks"

// Path resolves the same in the worktree and in the future main checkout —
// `banks.test.ts` sits next to `banks.ts`, three levels below `src/`.
const ASSETS_DIR = path.resolve(__dirname, "../../assets/banks")

function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe("bank logo files", () => {
  const files = readdirSync(ASSETS_DIR).filter((file) => file !== "SOURCES.md")

  it("has at least one logo file on disk", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)("%s is a real, correctly sized SVG or PNG", (file) => {
    const full = path.join(ASSETS_DIR, file)

    if (file.endsWith(".svg")) {
      const text = readFileSync(full, "utf8").trimStart()
      expect(text.startsWith("<svg") || text.startsWith("<?xml")).toBe(true)
      return
    }

    if (file.endsWith(".png")) {
      const buffer = readFileSync(full)
      expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
      const { width, height } = pngSize(buffer)
      // Wordmark logos are often wide and short (or the reverse) — the
      // requirement is "not a tiny icon", not "square", so the check is on
      // the larger side, not both.
      expect(Math.max(width, height)).toBeGreaterThanOrEqual(128)
      return
    }

    throw new Error(`Unexpected file in src/assets/banks: ${file}`)
  })
})

describe("BANK_LOGOS", () => {
  it("only has keys that match a name in BANKS (guards against typos)", () => {
    const names = new Set(BANKS.map((bank) => bank.name))
    for (const name of Object.keys(BANK_LOGOS)) {
      expect(names.has(name)).toBe(true)
    }
  })

  it("resolves every entry to a non-empty imported asset URL", () => {
    for (const url of Object.values(BANK_LOGOS)) {
      expect(typeof url).toBe("string")
      expect((url as string).length).toBeGreaterThan(0)
    }
  })

  it("wires BANKS[].logo from BANK_LOGOS by name", () => {
    for (const bank of BANKS) {
      expect(bank.logo).toBe(BANK_LOGOS[bank.name])
    }
  })
})
