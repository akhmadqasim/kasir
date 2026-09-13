// Bundles this package's own source into one CommonJS file. `whatsapp-web.js`
// (and everything it drags in — puppeteer, ws, and their own dynamic
// `require()`s of package-relative files) is kept external and resolved from
// `node_modules` at runtime instead of being bundled: puppeteer looks up its
// own install directory relative to `__dirname`, which a single-file bundle
// would break. `dist/index.js` therefore only ever runs with `node_modules`
// sitting next to it — true for `bun install` in this directory during
// development, and shipped as a resource next to the sidecar executable in a
// release build (see `CLAUDE.md` and `scripts/release.ps1`).
import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
const external = Object.keys(pkg.dependencies ?? {})

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external,
  logLevel: "info",
})

// `tauri-build` checks that every `bundle.externalBin` entry exists on disk
// before it will build *anything* — even a debug `cargo check`/`test`, which
// never runs this file at all (`whatsapp::process::dev_spawn_factory` invokes
// the system `node` directly instead). An empty placeholder satisfies that
// check for local development; `scripts/release.ps1` overwrites it with the
// real copy of `node.exe` a release ships.
try {
  const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim()
  const binariesDir = path.resolve("../../src-tauri/binaries")
  mkdirSync(binariesDir, { recursive: true })
  const placeholder = path.join(binariesDir, `whatsapp-sidecar-${targetTriple}.exe`)
  if (!existsSync(placeholder)) {
    writeFileSync(placeholder, "")
    console.log(`placeholder sidecar binary (dev only): ${placeholder}`)
  }
} catch (error) {
  console.warn(
    "Could not prepare src-tauri/binaries/whatsapp-sidecar-*.exe (is `rustc` on PATH?). " +
      "`cargo build`/`check`/`test` will fail until that file exists.",
    error,
  )
}
