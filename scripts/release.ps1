#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Build and publish a kasir (Tauri) release locally — no CI/CD required.

.DESCRIPTION
  1. Bumps the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
  2. Runs `bun run tauri build` (produces the Windows MSI + NSIS installers).
  3. Only if the build succeeds: commits the bump, creates an annotated tag
     vX.Y.Z, pushes, and creates a GitHub Release with the installers attached.

  Nothing is committed, tagged, pushed or published if the build fails.

.PARAMETER Version
  Semantic version to release, e.g. 0.5.0 (no leading "v").

.PARAMETER Jobs
  Parallel compile jobs (CARGO_BUILD_JOBS). Default 2 to avoid rustc OOM on
  high-core / limited-RAM machines (release builds are memory heavy). Raise on
  a beefy machine for speed. 0 = let cargo decide.

.PARAMETER Notes
  Release notes text. Empty = let GitHub auto-generate from commits.

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

# --- build ------------------------------------------------------------------
if ($Jobs -gt 0) { $env:CARGO_BUILD_JOBS = "$Jobs" }
Step "Building (bun run tauri build)  [CARGO_BUILD_JOBS=$($env:CARGO_BUILD_JOBS)]  — this can take a while..."
bun run tauri build
if ($LASTEXITCODE -ne 0) { Fail "Build failed (exit $LASTEXITCODE). Version files were bumped but nothing was committed/published." }

# --- locate artifacts -------------------------------------------------------
$bundle = Join-Path $root "src-tauri/target/release/bundle"
$msi  = Get-ChildItem "$bundle/msi/*.msi"        -ErrorAction SilentlyContinue | Select-Object -First 1
$nsis = Get-ChildItem "$bundle/nsis/*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$artifacts = @($msi, $nsis) | Where-Object { $_ }
if ($artifacts.Count -eq 0) { Fail "No installers found under $bundle (msi/nsis)." }
Step "Artifacts:"
$artifacts | ForEach-Object { Write-Host ("    {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }

if ($NoPublish) {
  Step "NoPublish set — bumped + built only. Installers are in $bundle."
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
