/**
 * One-off: carry the cashier's saved carts ("Transaksi Tersimpan") over from
 * the origin v0.5.0 ran on to the one v1.0.0 runs on.
 *
 * Up to v0.5.0 the window loaded the UI from `http://tauri.localhost`; since
 * v1.0.0 it loads `http://127.0.0.1:<port>`. The cart store lives in
 * `localStorage`, and localStorage is per origin, so after the update the
 * old carts are still on disk — WebView2 keeps every origin's entries in one
 * LevelDB — but invisible to the new origin. This copies the `kasir-cart`
 * entry across and merges any carts saved since the update.
 *
 * Run with the app CLOSED (WebView2 holds a lock on the database):
 *
 *   bun scripts/migrate-held-carts.ts [--from http://tauri.localhost] [--to http://127.0.0.1:17720] [--dir <leveldb dir>]
 *
 * The database is backed up next to itself first; the old entry is left in
 * place.
 */
import { cpSync, existsSync } from "node:fs"
import { join } from "node:path"
import { ClassicLevel } from "classic-level"

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1] ?? "")

const from = args.get("--from") ?? "http://tauri.localhost"
const to = args.get("--to") ?? "http://127.0.0.1:17720"
const dir =
  args.get("--dir") ??
  join(process.env.LOCALAPPDATA ?? "", "com.kasir.pos", "EBWebView", "Default", "Local Storage", "leveldb")
const STORE_KEY = "kasir-cart"

/** Chromium's Local Storage key: `_<origin>\0\x01<key>`. */
function storageKey(origin: string): Buffer {
  return Buffer.concat([Buffer.from(`_${origin}\0\x01`, "latin1"), Buffer.from(STORE_KEY, "latin1")])
}

/** Values carry one format byte: 0 = UTF-16LE, 1 = Latin-1. */
function decode(value: Buffer): string {
  return value[0] === 0 ? value.subarray(1).toString("utf16le") : value.subarray(1).toString("latin1")
}

function encode(text: string): Buffer {
  return Buffer.concat([Buffer.from([0]), Buffer.from(text, "utf16le")])
}

interface HeldCart {
  id: string
  label: string
  heldAt: number
}
interface PersistedCart {
  state: { heldCarts?: HeldCart[]; items?: unknown[]; [k: string]: unknown }
  version: number
}

if (!existsSync(dir)) {
  console.error(`Folder Local Storage tidak ditemukan: ${dir}`)
  process.exit(1)
}

const backup = `${dir}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
cpSync(dir, backup, { recursive: true, filter: (src) => !src.endsWith("LOCK") })
console.log(`Cadangan: ${backup}`)

const db = new ClassicLevel<Buffer, Buffer>(dir, {
  keyEncoding: "buffer",
  valueEncoding: "buffer",
  createIfMissing: false,
})
try {
  await db.open()
} catch (error) {
  console.error("Tidak bisa membuka database — tutup aplikasi kasir dulu, lalu ulangi.", error)
  process.exit(1)
}

try {
  const oldRaw = await db.get(storageKey(from))
  if (!oldRaw) {
    console.log(`Tidak ada keranjang tersimpan di ${from}; tidak ada yang dipindahkan.`)
    process.exit(0)
  }
  const old = JSON.parse(decode(oldRaw)) as PersistedCart
  const oldCarts = old.state.heldCarts ?? []

  const currentRaw = await db.get(storageKey(to))
  const current: PersistedCart = currentRaw
    ? (JSON.parse(decode(currentRaw)) as PersistedCart)
    : { state: {}, version: old.version }
  const currentCarts = current.state.heldCarts ?? []

  // Carts saved since the update win on a clash; the old ones fill in behind.
  const known = new Set(currentCarts.map((cart) => cart.id))
  const carried = oldCarts.filter((cart) => !known.has(cart.id))
  const merged: PersistedCart = {
    version: current.version ?? old.version,
    state: {
      ...old.state,
      ...current.state,
      heldCarts: [...currentCarts, ...carried].sort((a, b) => a.heldAt - b.heldAt),
      // The open cart only comes along when nothing has been rung up since.
      items: (current.state.items ?? []).length > 0 ? current.state.items : (old.state.items ?? []),
    },
  }

  await db.put(storageKey(to), encode(JSON.stringify(merged)))
  console.log(`Dipindahkan ${carried.length} keranjang dari ${from} ke ${to}:`)
  for (const cart of carried) console.log(`  - ${cart.label} (${new Date(cart.heldAt).toLocaleString("id-ID")})`)
  if (currentCarts.length > 0) console.log(`Digabung dengan ${currentCarts.length} keranjang yang sudah ada.`)
} finally {
  await db.close()
}
