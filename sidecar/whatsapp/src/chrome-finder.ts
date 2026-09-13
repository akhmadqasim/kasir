/**
 * Find an already-installed Microsoft Edge or Google Chrome, so Puppeteer
 * never has to download its own Chromium — the whole point of pointing it at
 * `executablePath` instead. Edge first: every Windows 10/11 machine ships it,
 * so a shop PC that never installed Chrome still works out of the box.
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

const REGISTRY_EXE_NAMES = ["msedge.exe", "chrome.exe"] as const

/** The registered install path for `exeName`, via the same `App Paths` key `Start` uses to resolve it. */
function fromRegistry(exeName: string): string | null {
  if (process.platform !== "win32") return null

  try {
    const output = execFileSync(
      "reg",
      ["query", `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`, "/ve"],
      { encoding: "utf8", windowsHide: true },
    )
    const match = /REG_SZ\s+(.+)$/m.exec(output)
    const path = match?.[1]?.trim()
    return path && existsSync(path) ? path : null
  } catch {
    // Not found under HKLM — a per-user install, or neither browser exists.
    return null
  }
}

/** Common install locations, tried when the registry lookup finds nothing. */
const FALLBACK_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
]

export function findBrowserExecutable(): string | null {
  for (const exeName of REGISTRY_EXE_NAMES) {
    const found = fromRegistry(exeName)
    if (found) return found
  }
  return FALLBACK_PATHS.find((path) => existsSync(path)) ?? null
}
