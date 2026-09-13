import { apiDelete, apiGet, apiPut, apiUpload } from "./client"

/**
 * The till window's zoom, driven from the Rust side.
 *
 * The page cannot zoom itself: CSS `zoom` on `<html>` scales the layout but
 * not the viewport, which is what put every modal off-screen. Real webview
 * zoom lives in the window, and the window is reached the way the updater is
 * — over the API, because the frontend has no Tauri IPC.
 */

export interface WindowZoom {
  factor: number
  /**
   * Whether `setWindowZoom` from this client would do anything. False on a
   * tablet reaching the server over the LAN, whose browser has its own zoom
   * and must not resize the desktop window in the next room.
   */
  available: boolean
}

export function getWindowZoom(): Promise<WindowZoom> {
  return apiGet<WindowZoom>("/window/zoom")
}

/** Answers with the factor as stored — clamped to the range the window accepts. */
export function setWindowZoom(factor: number): Promise<WindowZoom> {
  return apiPut<WindowZoom>("/window/zoom", { factor })
}

/**
 * Paint `png` — the store logo, drawn square by the page — on the window's
 * title bar and taskbar entry. Refused with a 409 from anything but the till
 * window itself.
 */
export function setWindowIcon(png: Blob): Promise<void> {
  return apiUpload<void>("/window/icon", png)
}

/** Back to the icon built into the executable. */
export function resetWindowIcon(): Promise<void> {
  return apiDelete<void>("/window/icon")
}
