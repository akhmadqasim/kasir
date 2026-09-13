/**
 * The wire format between this process and the Rust process manager.
 *
 * One JSON object per line, both directions — `stdout` carries events and
 * command acknowledgements, `stdin` carries commands. Never anything else on
 * `stdout`: a stray `console.log` from this process or a dependency would be
 * indistinguishable from a protocol line, so every diagnostic in this package
 * goes to `stderr` instead (see `index.ts`).
 */

export interface QrEvent {
  event: "qr"
  qr: string
}

export interface ReadyEvent {
  event: "ready"
  number: string
}

export interface DisconnectedEvent {
  event: "disconnected"
  reason: string
}

export interface ErrorEvent {
  event: "error"
  message: string
}

export type OutgoingEvent = QrEvent | ReadyEvent | DisconnectedEvent | ErrorEvent

export interface SendCommand {
  id: number
  cmd: "send"
  to: string
  text?: string
  imagePngBase64?: string
}

export interface LogoutCommand {
  id?: number
  cmd: "logout"
}

/**
 * Close the browser and exit, without invalidating the linked session the
 * way `logout` does. Sent when the feature is turned off or the app is
 * closing — either way, the shop expects it to reconnect without a QR next
 * time, so the session on disk must survive this.
 */
export interface ShutdownCommand {
  id?: number
  cmd: "shutdown"
}

export type IncomingCommand = SendCommand | LogoutCommand | ShutdownCommand

export type AckResult = { ok: true } | { ok: false; error: string }

/** Write one event line to stdout. */
export function emit(event: OutgoingEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

/**
 * Answer a command by its `id`. Silently does nothing without one — `logout`
 * is the one command Rust may send without waiting for a reply, and a stray
 * `{"id":undefined,...}` line would only confuse the pending-command map on
 * the other end.
 */
export function ack(id: number | undefined, result: AckResult): void {
  if (id === undefined) return
  const payload = result.ok ? { id, ok: true as const } : { id, ok: false as const, error: result.error }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Parse one line of stdin into a command, or `null` for anything that is not
 * one — a blank line, invalid JSON, or an object this version does not
 * recognise. Malformed input from Rust is a programming error on one side of
 * a protocol we both own, not something worth crashing the browser session
 * over, so it is dropped rather than thrown.
 */
export function parseCommand(line: string): IncomingCommand | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  if (parsed.cmd === "send" && typeof parsed.to === "string" && typeof parsed.id === "number") {
    return {
      id: parsed.id,
      cmd: "send",
      to: parsed.to,
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      imagePngBase64: typeof parsed.imagePngBase64 === "string" ? parsed.imagePngBase64 : undefined,
    }
  }

  if (parsed.cmd === "logout") {
    return {
      id: typeof parsed.id === "number" ? parsed.id : undefined,
      cmd: "logout",
    }
  }

  if (parsed.cmd === "shutdown") {
    return {
      id: typeof parsed.id === "number" ? parsed.id : undefined,
      cmd: "shutdown",
    }
  }

  return null
}
