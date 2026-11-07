/**
 * Build and publish a kasir release from this Linux PC; there is no CI/CD.
 *
 * 1. Bumps the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
 * 2. Builds the Windows NSIS installer (cross-compiled with cargo-xwin: the store
 *    PC runs Windows) and the Linux AppImage, deb and rpm. Because
 *    `bundle.createUpdaterArtifacts` is on, the CLI signs each bundle and writes
 *    the minisign signature next to it as `<bundle>.sig`.
 * 3. Writes `latest.json`, the manifest the in-app updater polls at
 *    https://github.com/<owner>/<repo>/releases/latest/download/latest.json.
 * 4. Only if every build succeeded: commits the bump, creates an annotated tag
 *    vX.Y.Z, pushes branch and tag together, and creates a GitHub Release with
 *    the bundles, their `.sig` files and `latest.json` attached. Publishing
 *    needs a clean working tree, so the tag holds exactly the code that was built.
 *
 * SIGNING. The updater only installs what the private key signed, so the script
 * refuses to start without it:
 *
 *   export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/kasir.key   # path or key content
 *   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""          # "" if the key has none
 *
 * Usage:
 *
 *   bun scripts/release.ts <X.Y.Z> [--jobs 2] [--notes "..."] [--no-publish]
 *
 *   --jobs        CARGO_BUILD_JOBS. Default 2: release builds are memory heavy and
 *                 cargo's default job count can OOM rustc. 0 = let cargo decide.
 *   --notes       Release notes, also shown in the app as the update's notes.
 *                 Empty = GitHub generates them from the commits.
 *   --no-publish  Bump + build only: no commit, tag, push or GitHub Release.
 *                 Works on a dirty working tree.
 */
import { spawnSync } from "node:child_process"
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, join } from "node:path"
import { parseArgs, styleText } from "node:util"

const ROOT = join(import.meta.dirname, "..")
const TARGET_DIR = join(ROOT, "src-tauri/target")
const MANIFEST_PATH = join(TARGET_DIR, "release/bundle/latest.json")
const USAGE = 'Usage: bun scripts/release.ts <X.Y.Z> [--jobs 2] [--notes "..."] [--no-publish]'

const JSON_VERSION = /("version"\s*:\s*")[^"]*(")/
const VERSION_FILES = [
  { path: "package.json", pattern: JSON_VERSION },
  { path: "src-tauri/tauri.conf.json", pattern: JSON_VERSION },
  // The first line-anchored `version = "..."` is the [package] version.
  { path: "src-tauri/Cargo.toml", pattern: /^(version\s*=\s*")[^"]*(")/m },
]

interface Options {
  version: string
  jobs: number
  notes: string
  publish: boolean
}

/** A bundle one build must produce, and the latest.json platforms it serves. */
interface BundleSpec {
  /** Relative to src-tauri/target. */
  dir: string
  suffix: string
  /** How the version shows in the file name, e.g. `_1.4.1_` or `-1.4.1-`. */
  versionMarker: (version: string) => string
  platforms: string[]
}

const underscored = (version: string): string => `_${version}_`
/** rpm names its files `kasir-1.4.1-1.x86_64.rpm`. */
const dashed = (version: string): string => `-${version}-`

/** One `tauri build` run. */
interface Build {
  label: string
  args: string[]
  tools: string[]
  /** Rust target the build compiles for, when it is not the host's. */
  rustTarget?: string
  bundles: BundleSpec[]
}

const BUILDS: Build[] = [
  {
    label: "Windows NSIS (cross-compiled)",
    // A Linux host's `--bundles` only accepts Linux formats, so the bundle list
    // goes in as config instead. MSI is left out: WiX only runs on Windows.
    args: [
      "--runner",
      "cargo-xwin",
      "--target",
      "x86_64-pc-windows-msvc",
      "--config",
      JSON.stringify({ bundle: { targets: ["nsis"] } }),
    ],
    // clang-cl compiles the bundled SQLite, lld-link links, llvm-rc embeds the icon.
    tools: ["cargo-xwin", "makensis", "clang-cl", "lld-link", "llvm-rc"],
    rustTarget: "x86_64-pc-windows-msvc",
    bundles: [
      {
        dir: "x86_64-pc-windows-msvc/release/bundle/nsis",
        suffix: "-setup.exe",
        versionMarker: underscored,
        // The plugin looks up `<os>-<arch>-<installer>`, then `<os>-<arch>`.
        // The fallback is NSIS because that is what the manual first install uses,
        // and because a cross-compiled exe lacks the bundle-type marker, so it
        // only ever asks for the fallback.
        platforms: ["windows-x86_64-nsis", "windows-x86_64"],
      },
    ],
  },
  {
    label: "Linux AppImage + deb + rpm",
    args: ["--bundles", "appimage,deb,rpm"],
    tools: [],
    bundles: [
      {
        dir: "release/bundle/appimage",
        suffix: ".AppImage",
        versionMarker: underscored,
        platforms: ["linux-x86_64-appimage", "linux-x86_64"],
      },
      {
        dir: "release/bundle/deb",
        suffix: ".deb",
        versionMarker: underscored,
        platforms: ["linux-x86_64-deb"],
      },
      {
        dir: "release/bundle/rpm",
        suffix: ".rpm",
        versionMarker: dashed,
        platforms: ["linux-x86_64-rpm"],
      },
    ],
  },
]

interface Artifact {
  path: string
  signaturePath: string
  spec: BundleSpec
}

interface PlatformEntry {
  signature: string
  url: string
}

interface Manifest {
  version: string
  notes?: string
  pub_date: string
  platforms: Record<string, PlatformEntry>
}

interface TauriConf {
  plugins?: { updater?: { endpoints?: string[] } }
}

function step(message: string): void {
  console.log(styleText("cyan", `==> ${message}`))
}

function fail(message: string): never {
  console.error(styleText("red", `ERROR: ${message}`))
  process.exit(1)
}

/** Runs a command with the terminal attached; true when it exits 0. */
function run(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "inherit" }).status === 0
}

/** Like `run`, with the command's output discarded. */
function succeeds(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0
}

function runOrFail(command: string, args: string[], failure: string): void {
  if (!run(command, args)) fail(failure)
}

function onPath(tool: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, tool), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/** No modified, staged or untracked files: what is built is what gets committed. */
function isWorkingTreeClean(): boolean {
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" })
  return status.status === 0 && status.stdout === ""
}

function parseArgv() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        jobs: { type: "string", default: "2" },
        notes: { type: "string", default: "" },
        "no-publish": { type: "boolean", default: false },
      },
    })
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`)
  }
}

function parseOptions(): Options {
  const { values, positionals } = parseArgv()
  const [version] = positionals
  if (positionals.length !== 1) fail(USAGE)
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Version '${version}' must be X.Y.Z (no leading 'v').`)
  const jobs = Number(values.jobs)
  if (!Number.isInteger(jobs) || jobs < 0)
    fail(`--jobs must be a whole number (0 = let cargo decide), got '${values.jobs}'.`)
  return { version, jobs, notes: values.notes.trim(), publish: !values["no-publish"] }
}

function checkTools(options: Options): void {
  // rustup installs to ~/.cargo/bin, which a non-login shell may not export.
  process.env.PATH = [join(homedir(), ".cargo/bin"), process.env.PATH].join(delimiter)
  const tools = [
    "bun",
    "cargo",
    "git",
    ...BUILDS.flatMap(({ tools }) => tools),
    ...(options.publish ? ["gh"] : []),
  ]
  for (const tool of tools) {
    if (!onPath(tool))
      fail(`'${tool}' not found on PATH.${tool === "gh" ? " Use --no-publish or install gh." : ""}`)
  }
  for (const target of BUILDS.flatMap(({ rustTarget }) => rustTarget ?? [])) {
    if (!installedRustTargets().includes(target))
      fail(`Rust target ${target} is not installed (run: rustup target add ${target}).`)
  }
}

function installedRustTargets(): string[] {
  const listed = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" })
  return listed.status === 0 ? listed.stdout.split("\n").map((line) => line.trim()) : []
}

/** `tauri signer generate` writes the minisign key file base64-encoded. */
function isSigningKeyContent(value: string): boolean {
  return Buffer.from(value, "base64").toString("utf8").startsWith("untrusted comment:")
}

/**
 * `tauri build` signs every bundle with this key because
 * `bundle.createUpdaterArtifacts` is on; without it the build itself fails, so
 * say so up front and say how to fix it. The key's value is never printed.
 */
function checkSigningKey(): void {
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()
  if (!key) {
    fail(`TAURI_SIGNING_PRIVATE_KEY is not set. The updater refuses unsigned releases.
  export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/kasir.key   # path or key content
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""          # if the key has no password
No key yet? Generate one: bunx tauri signer generate -w ~/.tauri/kasir.key
(then put the .pub content into src-tauri/tauri.conf.json plugins.updater.pubkey).`)
  }
  if (!isFile(key) && !isSigningKeyContent(key)) {
    fail("TAURI_SIGNING_PRIVATE_KEY is neither an existing file nor minisign key content.")
  }
  // An unset password makes the CLI prompt for one; an empty one means "none".
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ""
}

/**
 * Refuses to clobber an existing tag or release, and to tag uncommitted code;
 * needs gh logged in to publish.
 */
function checkPublishable(tag: string): void {
  if (!isWorkingTreeClean())
    fail("The working tree has uncommitted changes. Commit or stash them, or use --no-publish.")
  if (!succeeds("gh", ["auth", "status"])) fail("gh is not authenticated (run: gh auth login).")
  if (succeeds("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]))
    fail(`Tag ${tag} already exists locally.`)
  if (succeeds("git", ["ls-remote", "--exit-code", "--tags", "origin", tag]))
    fail(`Tag ${tag} already exists on origin.`)
}

/**
 * The repo the app polls for updates, read from the endpoint it is built with,
 * so the download URLs in latest.json can never point at a different repo.
 */
function updaterRepo(): string {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as TauriConf
  const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? ""
  const match =
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/.exec(
      endpoint,
    )
  if (!match) {
    fail(
      `plugins.updater.endpoints[0] in tauri.conf.json must be https://github.com/<owner>/<repo>/releases/latest/download/latest.json (got '${endpoint}').`,
    )
  }
  return match[1]
}

function bumpVersions(version: string): void {
  step(`Bumping version -> ${version}`)
  for (const { path, pattern } of VERSION_FILES) {
    if (!existsSync(path)) fail(`Missing ${path}`)
    const text = readFileSync(path, "utf8")
    if (!pattern.test(text)) fail(`Could not find a version field in ${path}`)
    const bumped = text.replace(pattern, `$1${version}$2`)
    if (bumped !== text) writeFileSync(path, bumped)
  }
}

function build({ label, args }: Build): void {
  step(
    `Building ${label} [CARGO_BUILD_JOBS=${process.env.CARGO_BUILD_JOBS ?? "cargo default"}]; this can take a while...`,
  )
  if (!run("bun", ["run", "tauri", "build", ...args])) {
    fail(`${label} build failed. Version files were bumped but nothing was committed/published.`)
  }
}

/**
 * Matches this version's file only: the bundle dir keeps bundles from earlier
 * builds, and an unversioned "first installer found" once shipped 1.0.0
 * binaries under the v1.1.0 tag.
 */
function locate(spec: BundleSpec, version: string): Artifact {
  const dir = join(TARGET_DIR, spec.dir)
  const marker = spec.versionMarker(version)
  const name = existsSync(dir)
    ? readdirSync(dir).find((file) => file.includes(marker) && file.endsWith(spec.suffix))
    : undefined
  if (!name) fail(`No *${marker}*${spec.suffix} found under ${dir}.`)
  const path = join(dir, name)
  const signaturePath = `${path}.sig`
  if (!isFile(signaturePath)) {
    fail(
      `No signature next to ${name}. Is bundle.createUpdaterArtifacts true and TAURI_SIGNING_PRIVATE_KEY valid?`,
    )
  }
  return { path, signaturePath, spec }
}

/** `downloadBase` is the release's asset URL prefix, `.../releases/download/vX.Y.Z`. */
function updaterManifest(artifacts: Artifact[], options: Options, downloadBase: string): Manifest {
  const platforms: Record<string, PlatformEntry> = {}
  for (const { path, signaturePath, spec } of artifacts) {
    const entry = {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `${downloadBase}/${basename(path)}`,
    }
    for (const platform of spec.platforms) platforms[platform] = entry
  }
  return {
    version: options.version,
    ...(options.notes ? { notes: options.notes } : {}),
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  }
}

function listArtifacts(paths: string[]): void {
  step("Artifacts:")
  for (const path of paths)
    console.log(`    ${path}  (${(statSync(path).size / 1024 / 1024).toFixed(1)} MB)`)
}

function commitTagPush(tag: string): void {
  step(`Committing bump, tagging ${tag}, pushing`)
  const files = [...VERSION_FILES.map(({ path }) => path), "src-tauri/Cargo.lock"]
  runOrFail("git", ["add", ...files], "git add failed.")
  runOrFail("git", ["commit", "-m", `chore(release): ${tag}`], "git commit failed.")
  runOrFail("git", ["tag", "-a", tag, "-m", `Release ${tag}`], "git tag failed.")
  // Atomic: either both land or neither, so a failed push never leaves the tag
  // on origin to block a rerun.
  runOrFail("git", ["push", "--atomic", "origin", "HEAD", `refs/tags/${tag}`], "git push failed.")
}

function createRelease(tag: string, paths: string[], notes: string): void {
  step(`Creating GitHub Release ${tag}`)
  const notesArgs = notes ? ["--notes", notes] : ["--generate-notes"]
  runOrFail(
    "gh",
    ["release", "create", tag, ...paths, "--title", tag, ...notesArgs, "--latest"],
    `gh release create failed (the tag was pushed; you can retry \`gh release create ${tag} ...\`).`,
  )
  step(`Done. Release ${tag} published:`)
  run("gh", ["release", "view", tag, "--json", "url", "-q", ".url"])
}

const options = parseOptions()
const tag = `v${options.version}`
process.chdir(ROOT)
step(`Repo: ${ROOT}  |  Release: ${tag}`)

// Bundles take their file modes from the umask: 022 gives 0755 binaries and
// 0644 files instead of the group-writable 0775/0664 a desktop session's 002 gives.
process.umask(0o022)
checkTools(options)
checkSigningKey()
const downloadBase = `https://github.com/${updaterRepo()}/releases/download/${tag}`
if (options.publish) checkPublishable(tag)

bumpVersions(options.version)
if (options.jobs > 0) process.env.CARGO_BUILD_JOBS = String(options.jobs)
BUILDS.forEach(build)

const artifacts = BUILDS.flatMap(({ bundles }) => bundles).map((spec) =>
  locate(spec, options.version),
)
writeFileSync(
  MANIFEST_PATH,
  `${JSON.stringify(updaterManifest(artifacts, options, downloadBase), null, 2)}\n`,
)
const uploads = [
  ...artifacts.flatMap(({ path, signaturePath }) => [path, signaturePath]),
  MANIFEST_PATH,
]
listArtifacts(uploads)

if (!options.publish) {
  step("--no-publish set: bumped + built only. Nothing was committed, tagged or published.")
  process.exit(0)
}

commitTagPush(tag)
createRelease(tag, uploads, options.notes)
