import { invoke } from "@tauri-apps/api/core"

type LogLevel = "startup" | "info" | "warning" | "error"

function writeLog(level: LogLevel, message: string): void {
  invoke("write_log_entry", { level, message }).catch(() => {
    // Logging must never block the app
  })
}

export const logger = {
  startup: (msg: string) => writeLog("startup", msg),
  info: (msg: string) => writeLog("info", msg),
  warning: (msg: string) => writeLog("warning", msg),
  error: (msg: string) => writeLog("error", msg),
}

export function installGlobalErrorHandlers(): void {
  window.onerror = (_message, source, lineno, colno, error) => {
    logger.error(
      `Unhandled error: ${error?.message ?? _message} at ${source}:${lineno}:${colno}\n${error?.stack ?? ""}`
    )
  }

  window.onunhandledrejection = (event) => {
    const reason = event.reason
    const msg =
      reason instanceof Error
        ? `${reason.message}\n${reason.stack ?? ""}`
        : String(reason)
    logger.error(`Unhandled rejection: ${msg}`)
  }
}
