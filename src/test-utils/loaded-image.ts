import { vi } from "vitest"

/**
 * Make every `new Image()` report itself as already loaded.
 *
 * Radix's `Avatar.Image` (which HeroUI's `Avatar` wraps) probes the `src` with
 * an off-screen `Image` and only renders the `<img>` once that probe reports
 * `complete` with a width. jsdom never loads images, so without this stub the
 * probe stays pending forever and a test can only ever see the fallback.
 */
export function stubLoadedImages(): void {
  class LoadedImage extends EventTarget {
    src = ""
    complete = true
    naturalWidth = 1
    referrerPolicy = ""
    crossOrigin: string | null = null
  }
  vi.stubGlobal("Image", LoadedImage)
}
