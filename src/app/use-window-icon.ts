import { useEffect, useRef } from "react"

import { useStoreInfo } from "@/features/settings/hooks/use-store-info"
import { storeLogoUrl } from "@/lib/api/settings"
import { resetWindowIcon, setWindowIcon } from "@/lib/api/window"
import { renderIconPng } from "./icon-png"

/**
 * Keep the window's icon in step with the store logo: painted when the logo
 * loads or changes, put back to the built-in mark when it is removed. Only
 * from the till window (`available`, the same answer the zoom uses) — a LAN
 * tablet must not repaint the desktop's taskbar. Nothing is stored: the exe
 * opens with its own icon and the page repaints it a moment after the store
 * row arrives.
 *
 * Failures are dropped on purpose. An icon that did not change is not worth a
 * toast on a screen the cashier is trying to sell from.
 */
export function useWindowIcon(available: boolean) {
  const { data: store } = useStoreInfo()
  const src = storeLogoUrl(store ?? null)
  // Whether this page has painted the icon; a fresh window already shows the
  // built-in one, so there is nothing to reset until it has.
  const painted = useRef(false)

  useEffect(() => {
    if (!available) return

    if (!src) {
      if (!painted.current) return
      painted.current = false
      resetWindowIcon().catch(() => {})
      return
    }

    let stale = false
    renderIconPng(src)
      .then((png) => {
        if (stale) return
        painted.current = true
        return setWindowIcon(png)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [available, src])
}
