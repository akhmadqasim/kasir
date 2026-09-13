import { id as t } from "@/i18n/id"
import type { UpdateStatus } from "../types"

/** One sentence for the status row in Pengaturan, whatever the phase. */
export function describeStatus(status: UpdateStatus): string {
  switch (status.phase) {
    case "idle":
      return t.updater.notChecked
    case "checking":
      return t.updater.checking
    case "up_to_date":
      return t.updater.upToDate
    case "available":
      return t.updater.available(status.version)
    case "downloading":
      return t.updater.downloading(status.version)
    case "ready":
      return t.updater.ready(status.version)
    case "installing":
      return t.updater.installing(status.version)
    case "failed":
      return status.message
  }
}

/**
 * A failed check that nobody asked for stays quiet; a failed download or
 * install always shows, because a person pressed the button that started it.
 */
export function isVisibleFailure(status: UpdateStatus | undefined): boolean {
  return status?.phase === "failed" && status.step !== "check"
}
