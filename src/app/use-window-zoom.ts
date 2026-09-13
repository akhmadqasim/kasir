import { useCallback, useEffect, useRef } from "react"
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
 * trip — and the answer of the *last* in-flight write is what the cache keeps,
 * so a burst of keypresses does not flicker through every intermediate answer.
 * The three callbacks are stable: they read the current factor from the cache
 * when pressed rather than closing over it, so the keydown listener bound to
 * them is registered once.
 */
export function useWindowZoom() {
  const queryClient = useQueryClient()
  const zoomKey = queryKeys.window.zoom

  const query = useApiQuery(zoomKey, getWindowZoom, { staleTime: Infinity })
  const { factor: zoom, available } = query.data ?? UNKNOWN

  const { mutate } = useApiMutation(setWindowZoom, {
    mutationKey: zoomKey,
    onMutate: async (factor) => {
      await queryClient.cancelQueries({ queryKey: zoomKey })
      queryClient.setQueryData<WindowZoom>(zoomKey, (current) => ({
        ...(current ?? UNKNOWN),
        factor,
      }))
    },
    onSettled: (data) => {
      // Counting this mutation too, so `1` means it is the last one out. An
      // earlier answer landing late must not overwrite a later keypress.
      if (queryClient.isMutating({ mutationKey: zoomKey }) !== 1) return
      if (data) queryClient.setQueryData(zoomKey, data)
      else void queryClient.invalidateQueries({ queryKey: zoomKey })
    },
  })

  const setZoom = useCallback(
    (next: (current: number) => number) => {
      const current = queryClient.getQueryData<WindowZoom>(zoomKey)?.factor ?? ZOOM_DEFAULT
      const factor = next(current)
      if (factor !== current) mutate(factor)
    },
    [queryClient, zoomKey, mutate],
  )

  // The one-time move from localStorage. Runs after the first answer, because
  // only then is it known whether this client may set the zoom at all; a LAN
  // browser just drops the key.
  const migrated = useRef(false)
  useEffect(() => {
    if (!query.data || migrated.current) return
    migrated.current = true
    const legacy = readLegacyZoom()
    if (legacy !== null && query.data.available && legacy !== query.data.factor) {
      mutate(legacy)
    }
  }, [query.data, mutate])

  return {
    zoom,
    available,
    zoomIn: useCallback(() => setZoom((z) => stepZoom(z, ZOOM_STEP)), [setZoom]),
    zoomOut: useCallback(() => setZoom((z) => stepZoom(z, -ZOOM_STEP)), [setZoom]),
    zoomReset: useCallback(() => setZoom(() => ZOOM_DEFAULT), [setZoom]),
  }
}
