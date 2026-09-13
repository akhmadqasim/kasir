import { execFile } from "node:child_process"

/**
 * Kill whatever is still holding this session's browser profile from an
 * earlier life of the sidecar.
 *
 * The app cannot always shut the sidecar down politely: in development the
 * Tauri watcher terminates the app outright on every Rust rebuild, and a
 * crash or a killed process does the same in production. The browser the
 * old sidecar launched then keeps running on the profile, and the next
 * sidecar's browser shares it — WhatsApp Web in two windows on one session
 * hangs every call, and eventually the phone logs the device out. So before
 * launching, anything whose command line names this profile (the browser's
 * `--user-data-dir`, or a previous sidecar started with the same argument)
 * is stopped. Windows only, which is where the app ships; elsewhere this is
 * a no-op.
 */
export function killOrphansUsing(sessionDir: string): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve()

  // PowerShell's -like pattern: backslashes are literal, but `[`, `]`, `*`
  // and `?` are wildcards and a single quote ends the string.
  const pattern = sessionDir.replace(/[\[\]*?]/g, "`$&").replace(/'/g, "''")
  const script = [
    `Get-CimInstance Win32_Process`,
    `| Where-Object { $_.CommandLine -like '*${pattern}*' -and $_.ProcessId -ne ${process.pid} }`,
    `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join(" ")

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 15_000 },
      (error) => {
        // Best-effort: a failure here only means the launch below may hit
        // the shared-profile problem, which is where things stood before.
        if (error) console.error("orphan cleanup failed", error.message)
        resolve()
      },
    )
  })
}
