/**
 * Entry point. Launched by Rust as `node dist/index.js <session-dir>` in
 * development, or as the bundled sidecar executable in a release build — see
 * `services/whatsapp/process.rs` on the Rust side.
 *
 * Every diagnostic here goes to `stderr` (`console.error`), never `stdout`:
 * `stdout` is the protocol channel and nothing else may write to it.
 */

import { createInterface } from "node:readline"

import { parseCommand } from "./protocol"
import { WhatsAppSession } from "./whatsapp-client"

async function main(): Promise<void> {
  const sessionDir = process.argv[2]
  if (!sessionDir) {
    console.error("usage: whatsapp-sidecar <session-dir>")
    process.exitCode = 1
    return
  }

  const session = new WhatsAppSession()

  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on("line", (line) => {
    const command = parseCommand(line)
    if (!command) return
    session.handle(command).catch((error: unknown) => {
      console.error("unhandled command error", error)
    })
  })

  process.on("SIGTERM", () => process.exit(0))
  process.on("SIGINT", () => process.exit(0))

  await session.start(sessionDir)
}

main().catch((error: unknown) => {
  console.error("fatal", error)
  process.exitCode = 1
})
