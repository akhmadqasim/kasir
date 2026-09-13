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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

  // Rust normally asks for a shutdown over stdin (see `protocol.ts`'s
  // `ShutdownCommand`) rather than a signal — `TerminateProcess`, the only
  // way Windows can kill another process, is not something Node can catch at
  // all. These exist for the cases something *does* send a real signal (a
  // `Ctrl+C` while running this by hand to reach the QR stage, a tree-kill
  // under WSL): close the browser before exiting instead of leaving it
  // behind, with a hard cap so a stuck `destroy()` cannot wedge the process
  // open forever.
  const handleSignal = () => {
    void Promise.race([session.shutdown(), sleep(3_000)]).finally(() => process.exit(0))
  }
  process.on("SIGTERM", handleSignal)
  process.on("SIGINT", handleSignal)

  await session.start(sessionDir)
}

main().catch((error: unknown) => {
  console.error("fatal", error)
  process.exitCode = 1
})
