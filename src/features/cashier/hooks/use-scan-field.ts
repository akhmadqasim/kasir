import { useCallback, useEffect, useRef, useState } from "react"

import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import { isBarcodeScannerCandidate } from "../search-behavior"

/** Keystrokes closer together than this belong to one scanner burst. */
const SCANNER_KEYSTROKE_GAP_MS = 50

interface ScanInputTiming {
  query: string
  startedAt: number
  lastInputAt: number
}

const EMPTY_TIMING: ScanInputTiming = { query: "", startedAt: 0, lastInputAt: 0 }

/**
 * The cashier's scan field: its text, the debounced copy the list search
 * runs on, and the keystroke timing that tells a scanner from a hand.
 *
 * The text is mirrored into a ref as well as state because an Enter handler
 * awaits a barcode lookup, and a following scan may type into the field
 * meanwhile — the handler has to see what is there *now*, not what its
 * render saw. `onClear` runs whenever the field is emptied, so the caller
 * can drop whatever it picked from the old results.
 *
 * A scan that starts after leftover text — a half-typed name, a code that was
 * never submitted — replaces that text once the burst looks like a barcode
 * (digits only, long enough), so the barcode is looked up on its own rather
 * than glued onto whatever was in the field. Timing alone is not enough: a
 * fast hand finishing a name types letters just as quickly.
 */
export function useScanField(onClear: () => void) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const searchQueryRef = useRef("")
  const inputTimingRef = useRef(EMPTY_TIMING)
  /** The field's text before the current burst's first keystroke. */
  const burstPrefixRef = useRef("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSearchQueryChange = useCallback((typed: string) => {
    let value = typed
    const now = Date.now()
    const previousValue = searchQueryRef.current
    const previousTiming = inputTimingRef.current
    const isSingleCharacterAppend =
      value.length === previousValue.length + 1 && value.startsWith(previousValue)
    const isContinuingFastInput =
      isSingleCharacterAppend && now - previousTiming.lastInputAt <= SCANNER_KEYSTROKE_GAP_MS

    if (!value) {
      burstPrefixRef.current = ""
      inputTimingRef.current = EMPTY_TIMING
    } else if (isContinuingFastInput) {
      const prefix = burstPrefixRef.current
      // A burst that reads as a barcode, typed after leftover text: the scan
      // replaces that text.
      if (prefix && isBarcodeScannerCandidate(value.slice(prefix.length))) {
        value = value.slice(prefix.length)
        burstPrefixRef.current = ""
      }
      inputTimingRef.current = {
        query: value,
        startedAt: previousTiming.startedAt,
        lastInputAt: now,
      }
    } else {
      burstPrefixRef.current = isSingleCharacterAppend ? previousValue : ""
      inputTimingRef.current = { query: value, startedAt: now, lastInputAt: now }
    }

    searchQueryRef.current = value
    setSearchQuery(value)
  }, [])

  const clearSearch = useCallback(() => {
    searchQueryRef.current = ""
    burstPrefixRef.current = ""
    inputTimingRef.current = EMPTY_TIMING
    setSearchQuery("")
    setDebouncedQuery("")
    onClear()
  }, [onClear])

  /**
   * Puts `value` back in the field after the field was emptied for a lookup
   * that missed, so the list search can run on it. Not a keystroke, so no
   * burst timing.
   */
  const restoreQuery = useCallback((value: string) => {
    searchQueryRef.current = value
    burstPrefixRef.current = ""
    inputTimingRef.current = EMPTY_TIMING
    setSearchQuery(value)
  }, [])

  /** The field's text right now, including keys typed during an await. */
  const readCurrentQuery = useCallback(() => searchQueryRef.current, [])
  /** Timing of the burst that typed the current text. */
  const readInputTiming = useCallback(() => inputTimingRef.current, [])

  return {
    searchQuery,
    debouncedQuery,
    /** Run the list search for `query` now, without waiting out the debounce. */
    searchNow: setDebouncedQuery,
    handleSearchQueryChange,
    clearSearch,
    restoreQuery,
    readCurrentQuery,
    readInputTiming,
  }
}
