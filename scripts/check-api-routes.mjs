/**
 * Cross-check every endpoint the frontend calls against the Rust route table.
 *
 * The frontend and the server agree on URLs by convention only: a typo in a
 * path is a 404 at runtime and nothing at build time. This reads the literal
 * `.route("...", get(...))` calls out of `src-tauri/src/http/routes/*.rs` and
 * the literal paths out of `src/lib/api/*.ts`, and reports any call the server
 * would not answer.
 *
 * Read-only; it never touches `src-tauri`. Run with `node scripts/check-api-routes.mjs`.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROUTES_DIR = "src-tauri/src/http/routes"
const API_DIR = "src/lib/api"

/** `{id}` and `{filename}` in axum become `*`, as does a `${...}` in a template literal. */
function normalise(path) {
  // `${...}` first: otherwise the `{...}` rule eats the braces and leaves a `$`.
  return path.replace(/\$\{[^}]*\}/g, "*").replace(/\{[^}]+\}/g, "*")
}

function rustRoutes() {
  const found = new Set()
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".rs")) continue
    const source = readFileSync(join(ROUTES_DIR, file), "utf8")
    // One `.route(...)` per line, possibly chaining verbs: `get(list).post(create)`.
    for (const match of source.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*(.+)$/gm)) {
      const path = normalise(match[1])
      for (const verb of match[2].matchAll(/\b(get|post|put|patch|delete)\s*\(/g)) {
        found.add(`${verb[1].toUpperCase()} ${path}`)
      }
    }
  }
  return found
}

function frontendCalls() {
  const found = new Map()
  for (const file of readdirSync(API_DIR)) {
    if (!file.endsWith(".ts")) continue
    const source = readFileSync(join(API_DIR, file), "utf8")
    const calls = [
      [/apiGet<[^>]*>\(\s*[`"]([^`"]+)[`"]/g, "GET"],
      [/apiPost<[^>]*>\(\s*[`"]([^`"]+)[`"]/g, "POST"],
      [/apiPut<[^>]*>\(\s*[`"]([^`"]+)[`"]/g, "PUT"],
      [/apiPatch<[^>]*>\(\s*[`"]([^`"]+)[`"]/g, "PATCH"],
      [/apiDelete<[^>]*>\(\s*[`"]([^`"]+)[`"]/g, "DELETE"],
      [/apiDownload\(\s*[`"]([^`"]+)[`"]/g, "GET"],
      [/apiUpload<[^>]*>\(\s*[`"]([^`"]+)[`"]/g, "POST"],
    ]
    for (const [pattern, method] of calls) {
      for (const match of source.matchAll(pattern)) {
        const key = `${method} ${normalise(match[1])}`
        if (!found.has(key)) found.set(key, file)
      }
    }
  }
  return found
}

const server = rustRoutes()
const client = frontendCalls()

const missing = [...client].filter(([route]) => !server.has(route))
const unused = [...server].filter((route) => !client.has(route))

console.log(`Rute server  : ${server.size}`)
console.log(`Dipakai klien: ${client.size}`)

if (missing.length > 0) {
  console.log("\nTIDAK ADA DI SERVER:")
  for (const [route, file] of missing) console.log(`  ${route}   (${API_DIR}/${file})`)
} else {
  console.log("\nSemua panggilan klien cocok dengan tabel rute server.")
}

console.log("\nAda di server, belum dipakai klien:")
for (const route of unused.sort()) console.log(`  ${route}`)

process.exit(missing.length > 0 ? 1 : 0)
