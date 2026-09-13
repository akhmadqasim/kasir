import type { UpdateStatus } from "@/features/updater/types"
import { apiGet, apiPost } from "./client"

/**
 * Self-update, driven by the Rust side and reported here.
 *
 * Reading and checking need a session; downloading and installing are admin
 * routes, because they close and replace the program running on the till. All
 * three writes answer with the status they moved to, so a caller can seed the
 * cache instead of waiting for the next poll.
 */

export function getUpdateStatus(): Promise<UpdateStatus> {
  return apiGet<UpdateStatus>("/updates")
}

/** Resolves once the check has finished, with the phase it ended in. */
export function checkForUpdate(): Promise<UpdateStatus> {
  return apiPost<UpdateStatus>("/updates/check")
}

/** Returns as soon as the download is running; progress arrives via the status. */
export function downloadUpdate(): Promise<UpdateStatus> {
  return apiPost<UpdateStatus>("/updates/download")
}

/** The app exits shortly after this answers; the installer relaunches it. */
export function installUpdate(): Promise<UpdateStatus> {
  return apiPost<UpdateStatus>("/updates/install")
}
