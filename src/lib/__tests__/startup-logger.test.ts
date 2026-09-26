import { beforeEach, describe, expect, it, vi } from "vitest"

const writeLogEntry = vi.fn<(level: string, message: string) => Promise<void>>()

vi.mock("@/lib/api/logs", () => ({
  writeLogEntry: (level: string, message: string) => writeLogEntry(level, message),
}))

async function loadLogger() {
  vi.resetModules()
  return import("@/lib/startup-logger")
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("startup logger", () => {
  beforeEach(() => {
    writeLogEntry.mockReset()
    writeLogEntry.mockResolvedValue(undefined)
  })

  it("does not post before a session exists", async () => {
    const { logger } = await loadLogger()
    logger.startup("boot")
    logger.info("login screen")
    await settle()
    expect(writeLogEntry).not.toHaveBeenCalled()
  })

  it("sends the buffered entries, in order, once the session starts", async () => {
    const { logger, setLogSessionActive } = await loadLogger()
    logger.startup("boot")
    logger.info("login screen")
    setLogSessionActive(true)
    await settle()
    expect(writeLogEntry.mock.calls).toEqual([
      ["startup", "boot"],
      ["info", "login screen"],
    ])
  })

  it("buffers again after the session ends", async () => {
    const { logger, setLogSessionActive } = await loadLogger()
    setLogSessionActive(true)
    setLogSessionActive(false)
    logger.error("after logout")
    await settle()
    expect(writeLogEntry).not.toHaveBeenCalled()
    setLogSessionActive(true)
    await settle()
    expect(writeLogEntry).toHaveBeenCalledWith("error", "after logout")
  })

  it("keeps an entry whose post failed and retries it with the next one", async () => {
    const { logger, setLogSessionActive } = await loadLogger()
    setLogSessionActive(true)
    writeLogEntry.mockRejectedValueOnce(new Error("server down"))
    logger.info("first")
    await settle()
    logger.info("second")
    await settle()
    expect(writeLogEntry.mock.calls.map(([, message]) => message)).toEqual([
      "first",
      "first",
      "second",
    ])
  })
})
