import { writeLogEntry, type LogLevel } from "@/lib/api/logs"

/**
 * Client-side logging, over HTTP, without ever getting in the way.
 *
 * Two things changed when this stopped being a Tauri command. The endpoint
 * needs a session, and the first thing this file logs is that `main.tsx` is
 * running — long before anybody has logged in. And an HTTP request can fail in
 * ways an IPC call could not: the server may not be listening yet while the
 * window is still loading.
 *
 * So entries go into a small buffer and are flushed in order — but only while a
 * session exists. Before login the buffer just fills: posting would only earn
 * a 401 for every line and a red entry in the console of the login screen.
 * The auth store reports the session through `setLogSessionActive`, and the
 * moment it turns on (login, or a session restored at boot) the backlog goes
 * out. A flush that fails keeps its entry at the front and stops, and the next
 * entry tries again. Nothing here ever rejects, and nothing here ever blocks a render: a
 * lost log line is a lost log line, while an unhandled rejection from the
 * logger would be an error report that causes errors.
 */

interface PendingEntry {
  level: LogLevel
  message: string
}

/**
 * How many entries to keep while the server is unreachable. Enough for a boot
 * sequence and a stack trace; small enough that a server that never comes back
 * cannot grow this without bound.
 */
const MAX_BUFFERED_ENTRIES = 50

let buffer: PendingEntry[] = []
let flushing = false
let sessionActive = false

async function flush(): Promise<void> {
  if (flushing || !sessionActive) return
  flushing = true

  try {
    while (sessionActive && buffer.length > 0) {
      const entry = buffer[0]
      try {
        await writeLogEntry(entry.level, entry.message)
      } catch {
        // Not logged in yet, or the server is not up. Keep the entry and stop;
        // the next call retries. Reporting this failure anywhere would mean
        // logging about logging.
        return
      }
      buffer.shift()
    }
  } finally {
    flushing = false
  }
}

function writeLog(level: LogLevel, message: string): void {
  buffer.push({ level, message })
  if (buffer.length > MAX_BUFFERED_ENTRIES) {
    buffer = buffer.slice(-MAX_BUFFERED_ENTRIES)
  }
  void flush()
}

export const logger = {
  startup: (msg: string) => writeLog("startup", msg),
  info: (msg: string) => writeLog("info", msg),
  warning: (msg: string) => writeLog("warning", msg),
  error: (msg: string) => writeLog("error", msg),
}

/**
 * Tell the logger whether `POST /api/logs` can succeed. Turning it on sends the
 * backlog; turning it off (logout, expired session) makes new entries wait in
 * the buffer again instead of failing one by one.
 */
export function setLogSessionActive(active: boolean): void {
  sessionActive = active
  if (active) void flush()
}

export function installGlobalErrorHandlers(): void {
  window.onerror = (_message, source, lineno, colno, error) => {
    logger.error(
      `Unhandled error: ${error?.message ?? _message} at ${source}:${lineno}:${colno}\n${error?.stack ?? ""}`,
    )
  }

  window.onunhandledrejection = (event) => {
    const reason = event.reason
    const msg =
      reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason)
    logger.error(`Unhandled rejection: ${msg}`)
  }
}
