/**
 * The `whatsapp-web.js` client, wired to the protocol in `protocol.ts`.
 *
 * One instance per process, one WhatsApp session per instance — the process
 * *is* the "enabled" state as far as Rust is concerned: it is spawned to turn
 * the feature on and killed to turn it off, so nothing here manages more than
 * one client at a time.
 */

import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js"

import { findBrowserExecutable } from "./chrome-finder"
import { normalizePhoneNumber, toChatId } from "./phone-number"
import { ack, emit, type IncomingCommand, type SendCommand } from "./protocol"

/** Random human-ish pause before every send, so a burst of receipts does not
 * look like a bot to WhatsApp's own abuse detection. */
const MIN_SEND_DELAY_MS = 2_000
const MAX_SEND_DELAY_MS = 6_000

function randomDelayMs(): number {
  return MIN_SEND_DELAY_MS + Math.floor(Math.random() * (MAX_SEND_DELAY_MS - MIN_SEND_DELAY_MS + 1))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class WhatsAppSession {
  private client: Client | null = null
  private ready = false

  /**
   * Launch the browser and start linking (or resuming, if `sessionDir` already
   * holds one) the WhatsApp session. Resolves once `initialize()` has been
   * kicked off — the `qr`/`ready`/`disconnected` events are what actually
   * report how it went, not this promise.
   */
  async start(sessionDir: string): Promise<void> {
    const executablePath = findBrowserExecutable()
    if (!executablePath) {
      emit({
        event: "error",
        message:
          "Microsoft Edge atau Google Chrome tidak ditemukan di komputer ini. Instal salah satunya untuk memakai fitur WhatsApp.",
      })
      return
    }

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionDir }),
      puppeteer: {
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    })

    client.on("qr", (qr) => emit({ event: "qr", qr }))

    client.on("ready", () => {
      this.ready = true
      emit({ event: "ready", number: client.info?.wid?.user ?? "" })
    })

    client.on("auth_failure", (message) => {
      emit({ event: "error", message: `Autentikasi WhatsApp gagal: ${message}` })
    })

    client.on("disconnected", (reason) => {
      this.ready = false
      emit({ event: "disconnected", reason: String(reason) })
    })

    this.client = client

    try {
      await client.initialize()
    } catch (error) {
      emit({ event: "error", message: `Gagal memulai WhatsApp: ${describeError(error)}` })
    }
  }

  async handle(command: IncomingCommand): Promise<void> {
    switch (command.cmd) {
      case "send":
        await this.handleSend(command)
        return
      case "logout":
        await this.handleLogout(command.id)
        return
      case "shutdown":
        await this.handleShutdown(command.id)
        return
    }
  }

  /**
   * Close the browser (if one was ever opened) and exit, without
   * invalidating the linked session — `Client.logout()` is what does that,
   * and this is deliberately not that. Also what the process's own
   * `SIGTERM`/`SIGINT` handlers call: a plain `process.exit()` there would
   * leave the browser it launched running as an orphan, because killing this
   * process is not something the browser is watching for.
   */
  async shutdown(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.destroy()
    } catch (error) {
      // Best-effort: the browser may already be gone (crashed, or the OS
      // killed it directly), and that is not a reason to hang here.
      console.error("error while closing the browser", error)
    }
  }

  private async handleSend(command: SendCommand): Promise<void> {
    const { id, to, text, imagePngBase64 } = command

    if (!this.client || !this.ready) {
      ack(id, { ok: false, error: "WhatsApp belum siap." })
      return
    }

    const normalized = normalizePhoneNumber(to)
    if (!normalized) {
      ack(id, { ok: false, error: "Nomor WhatsApp tidak valid." })
      return
    }

    try {
      const numberId = await this.client.getNumberId(toChatId(normalized))
      if (!numberId) {
        ack(id, { ok: false, error: "Nomor ini tidak terdaftar di WhatsApp." })
        return
      }

      // A pause before every send, in flight order: two cashiers sending at
      // once still queue through this one process, one send at a time.
      await sleep(randomDelayMs())

      if (imagePngBase64) {
        const media = new MessageMedia("image/png", imagePngBase64, "struk.png")
        await this.client.sendMessage(numberId._serialized, media, { caption: text })
      } else {
        await this.client.sendMessage(numberId._serialized, text ?? "")
      }

      ack(id, { ok: true })
    } catch (error) {
      ack(id, { ok: false, error: describeError(error) })
    }
  }

  private async handleLogout(id: number | undefined): Promise<void> {
    if (!this.client) {
      ack(id, { ok: false, error: "WhatsApp belum aktif." })
      return
    }

    try {
      await this.client.logout()
      ack(id, { ok: true })
    } catch (error) {
      ack(id, { ok: false, error: describeError(error) })
    } finally {
      // `Client.logout()` already closes the browser itself before
      // resolving. The session this process held is gone either way; Rust
      // re-spawns a fresh process (and a fresh QR) the next time the feature
      // is enabled.
      setTimeout(() => process.exit(0), 250)
    }
  }

  private async handleShutdown(id: number | undefined): Promise<void> {
    await this.shutdown()
    ack(id, { ok: true })
    process.exit(0)
  }
}
