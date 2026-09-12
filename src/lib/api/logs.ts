import { apiPost } from "./client"

export type LogLevel = "startup" | "info" | "warning" | "error"

/**
 * Append a line to the till's log files.
 *
 * Needs a session, which is why the startup logger buffers: an entry written
 * before login has nowhere to go yet, and losing a log entry must never be
 * allowed to matter more than the screen the user is looking at.
 */
export function writeLogEntry(level: LogLevel, message: string): Promise<void> {
  return apiPost<void>("/logs", { level, message })
}
