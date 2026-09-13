import { useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { getWindowZoom, setWindowZoom, type WindowZoom } from "@/lib/api/window"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * Mirror of `UI_ZOOM_MIN`/`UI_ZOOM_MAX` in `domain/settings.rs`. The server
 * clamps whatever it is sent; these only decide when the toolbar's buttons go
 * grey, so the two may drift without anything breaking.
 */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.0
export const ZOOM_STEP = 0.1
const ZOOM_DEFAULT = 1.0

/**
 * Where the zoom lived before it moved to the window. Read once and removed,
 * so a till that had set 150 % under the old scheme keeps it.
 */
export const LEGACY_ZOOM_KEY = "kasir-zoom-level"

const UNKNOWN: WindowZoom = { factor: ZOOM_DEFAULT, available: false }

/** One step from `zoom`, kept on tenths so 1.1 + 0.1 reads 1.2 and not 1.2000000000000002. */
export function stepZoom(zoom: number, step: number): number {
  const next = Math.round((zoom + step) * 10) / 10
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
}

function readLegacyZoom(): number | null {
  const stored = localStorage.getItem(LEGACY_ZOOM_KEY)
  if (stored === null) return null
  localStorage.removeItem(LEGACY_ZOOM_KEY)
  const value = parseFloat(stored)
  return Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX ? value : null
}

/**
 * The window's zoom as the server knows it, and the three ways to move it.
 *
 * `available` is false until the first answer arrives and stays false on a
 * LAN browser; callers hide the toolbar and leave Ctrl+/− to the browser then.
 * Writes are optimistic — the label moves on the keypress, not on the round
 * trip — and the cache is only refetched once the last in-flight write lands,
 * so a burst of keypresses does not flicker through every intermediate answer.
 */
export function useWindowZoom() {
  const queryClient = useQueryClient()
  const zoomKey = queryKeys.window.zoom

  const query = useApiQuery(zoomKey, getWindowZoom, { staleTime: Infinity })
  const { factor: zoom, available } = query.data ?? UNKNOWN

  const mutation = useApiMutation(setWindowZoom, {
    mutationKey: zoomKey,
    onMutate: async (factor) => {
      await queryClient.cancelQueries({ queryKey: zoomKey })
      queryClient.setQueryData<WindowZoom>(zoomKey, (current) => ({
        ...(current ?? UNKNOWN),
        factor,
      }))
    },
    onSettled: () => {
      // Counting this mutation too, so `1` means it is the last one out.
      if (queryClient.isMutating({ mutationKey: zoomKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: zoomKey })
      }
    },
  })
  const { mutate } = mutation

  const setZoom = useCallback(
    (factor: number) => {
      if (factor !== zoom) mutate(factor)
    },
    [mutate, zoom],
  )

  // The one-time move from localStorage. Runs after the first answer, because
  // only then is it known whether this client may set the zoom at all; a LAN
  // browser just drops the key.
  useEffect(() => {
    if (!query.data) return
    const legacy = readLegacyZoom()
    if (legacy !== null && query.data.available && legacy !== query.data.factor) {
      mutate(legacy)
    }
  }, [query.data, mutate])

  return {
    zoom,
    available,
    zoomIn: useCallback(() => setZoom(stepZoom(zoom, ZOOM_STEP)), [setZoom, zoom]),
    zoomOut: useCallback(() => setZoom(stepZoom(zoom, -ZOOM_STEP)), [setZoom, zoom]),
    zoomReset: useCallback(() => setZoom(ZOOM_DEFAULT), [setZoom]),
  }
}
