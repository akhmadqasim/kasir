import { useCallback, useEffect, useRef, type RefObject } from "react"

/** Long enough for a closing dialog to have handed focus back to its trigger. */
const FOCUS_DELAY_MS = 50

/**
 * A function that focuses `ref`'s element a moment later. One pending focus at
 * a time, dropped on unmount: a timer left behind would focus a field that is
 * gone, or steal focus from the next screen.
 */
export function useDeferredFocus(ref: RefObject<HTMLElement | null>): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => ref.current?.focus(), FOCUS_DELAY_MS)
  }, [ref])
}
