#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Build and publish a kasir (Tauri) release locally — no CI/CD required.

.DESCRIPTION
  1. Bumps the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
  2. Runs `bun run tauri build` (produces the Windows MSI + NSIS installers and,
     because `bundle.createUpdaterArtifacts` is on, a minisign `.sig` next to each).
  3. Writes `latest.json`, the manifest the in-app updater polls at
     https://github.com/<owner>/<repo>/releases/latest/download/latest.json.
  4. Only if the build succeeds: commits the bump, creates an annotated tag
     vX.Y.Z, pushes, and creates a GitHub Release with the installers, their
     `.sig` files and `latest.json` attached.

  Nothing is committed, tagged, pushed or published if the build fails.

  SIGNING. The updater only installs what the private key signed, so the build
  refuses to start without it:

    $env:TAURI_SIGNING_PRIVATE_KEY          = "$env:USERPROFILE\.tauri\kasir.key"  # path or key content
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""                                   # "" if the key has none

  The matching public key lives in src-tauri/tauri.conf.json (plugins.updater.pubkey).
  Generate a pair once with `bunx tauri signer generate -w ~/.tauri/kasir.key`;
  losing the private key means every installed copy stops accepting updates.

.PARAMETER Version
  Semantic version to release, e.g. 0.5.0 (no leading "v").

.PARAMETER Jobs
  Parallel compile jobs (CARGO_BUILD_JOBS). Default 2 to avoid rustc OOM on
  high-core / limited-RAM machines (release builds are memory heavy). Raise on
  a beefy machine for speed. 0 = let cargo decide.

.PARAMETER Notes
  Release notes text. Empty = let GitHub auto-generate from commits. Also
  shown inside the app as the update's notes, when given.

.PARAMETER NoPublish
  Build + bump only. Skip git tag/push and the GitHub Release (dry run-ish).

.EXAMPLE
  pwsh scripts/release.ps1 -Version 0.5.0
  pwsh scripts/release.ps1 -Version 0.5.1 -Jobs 4 -Notes "Perbaikan kasir."
  pwsh scripts/release.ps1 -Version 0.6.0 -NoPublish   # build locally, don't publish
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [int]$Jobs = 2,
  [string]$Notes = "",
  [switch]$NoPublish
)

$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# --- validate version -------------------------------------------------------
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "Version '$Version' must be X.Y.Z (no leading 'v')." }
$Tag = "v$Version"

# repo root = parent of the scripts/ dir this file lives in
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Step "Repo: $root  |  Release: $Tag"

# --- preflight --------------------------------------------------------------
# cargo on PATH (rustup installs to ~/.cargo/bin, not always exported)
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
foreach ($tool in @("bun", "cargo", "git")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "'$tool' not found on PATH." }
}
# The updater signing key. `tauri build` signs every installer with it because
# `bundle.createUpdaterArtifacts` is on; without it the build itself fails, so
# say so up front and say how to fix it.
if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  Fail @"
TAURI_SIGNING_PRIVATE_KEY is not set. The updater refuses unsigned releases.
  `$env:TAURI_SIGNING_PRIVATE_KEY = "`$env:USERPROFILE\.tauri\kasir.key"   # path or key content
  `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""                             # if the key has no password
No key yet? Generate one: bunx tauri signer generate -w ~/.tauri/kasir.key
(then put the .pub content into src-tauri/tauri.conf.json plugins.updater.pubkey).
"@
}
if ((Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY -PathType Leaf -ErrorAction SilentlyContinue) -eq $false -and
    $env:TAURI_SIGNING_PRIVATE_KEY -notmatch '^untrusted comment') {
  Fail "TAURI_SIGNING_PRIVATE_KEY is neither an existing file nor key content: $env:TAURI_SIGNING_PRIVATE_KEY"
}
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  # An unset password makes the CLI prompt for one; an empty one means "none".
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
}

# The repo the app polls for updates, read from the endpoint it is built with,
# so the download URLs in latest.json can never point at a different repo.
$tauriConf = Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$endpoint = @($tauriConf.plugins.updater.endpoints)[0]
if ($endpoint -notmatch '^https://github\.com/([^/]+/[^/]+)/releases/latest/download/latest\.json$') {
  Fail "plugins.updater.endpoints[0] in tauri.conf.json must be https://github.com/<owner>/<repo>/releases/latest/download/latest.json (got '$endpoint')."
}
$repoSlug = $Matches[1]

if (-not $NoPublish) {
  if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) { Fail "'gh' (GitHub CLI) not found; use -NoPublish or install gh." }
  gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Fail "gh is not authenticated (run: gh auth login)." }
  # refuse to clobber an existing tag/release
  git rev-parse -q --verify "refs/tags/$Tag" *> $null
  if ($LASTEXITCODE -eq 0) { Fail "Tag $Tag already exists locally." }
  git ls-remote --exit-code --tags origin $Tag *> $null
  if ($LASTEXITCODE -eq 0) { Fail "Tag $Tag already exists on origin." }
}

# --- bump version in the three sources --------------------------------------
function Set-JsonVersion($path, $version) {
  if (-not (Test-Path $path)) { Fail "Missing $path" }
  $text = Get-Content $path -Raw
  $new = [regex]::new('("version"\s*:\s*")[^"]*(")').Replace($text, "`${1}$version`${2}", 1)
  if ($new -eq $text) { Fail "Could not find a version field in $path" }
  Set-Content -Path $path -Value $new -NoNewline
}
function Set-CargoVersion($path, $version) {
  if (-not (Test-Path $path)) { Fail "Missing $path" }
  $text = Get-Content $path -Raw
  # first line-anchored `version = "..."` = the [package] version
  $new = [regex]::new('(?m)^(version\s*=\s*")[^"]*(")').Replace($text, "`${1}$version`${2}", 1)
  if ($new -eq $text) { Fail "Could not find [package] version in $path" }
  Set-Content -Path $path -Value $new -NoNewline
}

Step "Bumping version -> $Version"
Set-JsonVersion  (Join-Path $root "package.json") $Version
Set-JsonVersion  (Join-Path $root "src-tauri/tauri.conf.json") $Version
Set-CargoVersion (Join-Path $root "src-tauri/Cargo.toml") $Version

# --- WhatsApp sidecar --------------------------------------------------------
# `externalBin` needs a real file at src-tauri/binaries/whatsapp-sidecar-<target-triple>.exe
# before `tauri build` runs. It is a renamed copy of the Node binary that built
# it, not a Node single-executable application — see CLAUDE.md for why SEA
# was tried and set aside for this sidecar (whatsapp-web.js/puppeteer's own
# dynamic `require()`s and file lookups do not survive being embedded in one
# blob). `bundle.resources` in tauri.conf.json ships `sidecar/whatsapp/dist`
# (the esbuild output plus a real, non-symlinked `node_modules`) next to it.
Step "Preparing WhatsApp sidecar"
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) { Fail "'node' not found on PATH; needed to build and to vendor as the sidecar binary." }
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) { Fail "'npm' not found on PATH; needed for a non-symlinked sidecar node_modules (bun's own store symlinks, which do not survive being copied into the installer)." }

bun run build:sidecar
if ($LASTEXITCODE -ne 0) { Fail "Sidecar build failed (bun run build:sidecar)." }

$sidecarDist = Join-Path $root "sidecar/whatsapp/dist"
Copy-Item (Join-Path $root "sidecar/whatsapp/package.json") $sidecarDist -Force
Push-Location $sidecarDist
try {
  # Chromium is never launched from this copy — only `executablePath` builds
  # are — so skip the ~200 MB download `puppeteer` (a `whatsapp-web.js`
  # dependency) otherwise does on install.
  $env:PUPPETEER_SKIP_DOWNLOAD = "true"
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed while vendoring the sidecar's node_modules." }
} finally {
  Pop-Location
}

$targetTriple = (rustc --print host-tuple).Trim()
$binariesDir = Join-Path $root "src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null
$sidecarExe = Join-Path $binariesDir "whatsapp-sidecar-$targetTriple.exe"
Copy-Item (Get-Command node).Source $sidecarExe -Force
Step "Sidecar ready: $sidecarExe + $sidecarDist"

# --- build ------------------------------------------------------------------
if ($Jobs -gt 0) { $env:CARGO_BUILD_JOBS = "$Jobs" }
Step "Building (bun run tauri build)  [CARGO_BUILD_JOBS=$($env:CARGO_BUILD_JOBS)]  — this can take a while..."
bun run tauri build
if ($LASTEXITCODE -ne 0) { Fail "Build failed (exit $LASTEXITCODE). Version files were bumped but nothing was committed/published." }

# --- locate artifacts -------------------------------------------------------
$bundle = Join-Path $root "src-tauri/target/release/bundle"
# Match this version's files only: the bundle dir keeps installers from earlier
# builds, and a bare `*.msi | Select -First 1` once shipped 1.0.0 binaries
# under the v1.1.0 tag.
$msi  = Get-ChildItem "$bundle/msi/*_${Version}_*.msi"        -ErrorAction SilentlyContinue | Select-Object -First 1
$nsis = Get-ChildItem "$bundle/nsis/*_${Version}_*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nsis) { Fail "No NSIS installer (*_${Version}_*-setup.exe) found under $bundle/nsis; the updater's primary artifact is missing." }
$installers = @($nsis, $msi) | Where-Object { $_ }

# `createUpdaterArtifacts: true` signs each installer in place and writes the
# minisign signature next to it as `<installer>.sig`.
$signatures = foreach ($installer in $installers) {
  $sig = Get-Item -LiteralPath "$($installer.FullName).sig" -ErrorAction SilentlyContinue
  if (-not $sig) { Fail "No signature next to $($installer.Name). Is bundle.createUpdaterArtifacts true and TAURI_SIGNING_PRIVATE_KEY valid?" }
  $sig
}

# --- updater manifest -------------------------------------------------------
# The plugin looks up `windows-x86_64-nsis` / `windows-x86_64-msi` by how the
# running copy was installed, then falls back to `windows-x86_64`; the fallback
# is the NSIS installer because that is what the manual first install uses.
function New-PlatformEntry($installer) {
  [ordered]@{
    signature = (Get-Content -LiteralPath "$($installer.FullName).sig" -Raw).Trim()
    url       = "https://github.com/$repoSlug/releases/download/$Tag/$($installer.Name)"
  }
}
$nsisEntry = New-PlatformEntry $nsis
$platforms = [ordered]@{ "windows-x86_64-nsis" = $nsisEntry }
if ($msi) { $platforms["windows-x86_64-msi"] = New-PlatformEntry $msi }
$platforms["windows-x86_64"] = $nsisEntry

$manifest = [ordered]@{
  version   = $Version
  pub_date  = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  platforms = $platforms
}
if (-not [string]::IsNullOrWhiteSpace($Notes)) { $manifest.Insert(1, "notes", $Notes) }

$manifestPath = Join-Path $bundle "latest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
$latest = Get-Item -LiteralPath $manifestPath

$artifacts = @($installers) + @($signatures) + @($latest)
Step "Artifacts:"
$artifacts | ForEach-Object { Write-Host ("    {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }

if ($NoPublish) {
  Step "NoPublish set — bumped + built only. Installers, .sig files and latest.json are in $bundle."
  exit 0
}

# --- commit, tag, push ------------------------------------------------------
Step "Committing bump, tagging $Tag, pushing"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): $Tag"
if ($LASTEXITCODE -ne 0) { Fail "git commit failed." }
git tag -a $Tag -m "Release $Tag"
if ($LASTEXITCODE -ne 0) { Fail "git tag failed." }
git push --follow-tags origin HEAD
if ($LASTEXITCODE -ne 0) { Fail "git push failed." }

# --- GitHub Release ---------------------------------------------------------
Step "Creating GitHub Release $Tag"
$paths = $artifacts | ForEach-Object { $_.FullName }
if ([string]::IsNullOrWhiteSpace($Notes)) {
  gh release create $Tag @paths --title $Tag --generate-notes --latest
} else {
  gh release create $Tag @paths --title $Tag --notes $Notes --latest
}
if ($LASTEXITCODE -ne 0) { Fail "gh release create failed (the tag was pushed; you can retry `gh release create $Tag ...`)." }

Step "Done. Release $Tag published: $(gh repo view --json url -q .url)/releases/tag/$Tag"
