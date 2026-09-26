import { useCallback, useEffect, useRef, useState } from "react"

import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"

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
 */
export function useScanField(onClear: () => void) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const searchQueryRef = useRef("")
  const inputTimingRef = useRef(EMPTY_TIMING)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSearchQueryChange = useCallback((value: string) => {
    const now = Date.now()
    const previousValue = searchQueryRef.current
    const previousTiming = inputTimingRef.current
    const isSingleCharacterAppend =
      value.length === previousValue.length + 1 && value.startsWith(previousValue)
    const isContinuingFastInput =
      isSingleCharacterAppend && now - previousTiming.lastInputAt <= SCANNER_KEYSTROKE_GAP_MS

    searchQueryRef.current = value

    if (!value) {
      inputTimingRef.current = EMPTY_TIMING
    } else if (isContinuingFastInput) {
      inputTimingRef.current = {
        query: value,
        startedAt: previousTiming.startedAt,
        lastInputAt: now,
      }
    } else {
      inputTimingRef.current = { query: value, startedAt: now, lastInputAt: now }
    }

    setSearchQuery(value)
  }, [])

  const clearSearch = useCallback(() => {
    searchQueryRef.current = ""
    inputTimingRef.current = EMPTY_TIMING
    setSearchQuery("")
    setDebouncedQuery("")
    onClear()
  }, [onClear])

  /**
   * `clearSearch` for after an awaited lookup: a following scan may already
   * have typed into the field meanwhile, so only the submitted text goes.
   */
  const clearSubmittedSearch = useCallback(
    (submitted: string) => {
      const current = searchQueryRef.current
      if (current === submitted || !current.startsWith(submitted)) {
        clearSearch()
        return
      }
      const rest = current.slice(submitted.length)
      searchQueryRef.current = rest
      inputTimingRef.current = { ...inputTimingRef.current, query: rest }
      setSearchQuery(rest)
      setDebouncedQuery("")
      onClear()
    },
    [clearSearch, onClear],
  )

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
    clearSubmittedSearch,
    readCurrentQuery,
    readInputTiming,
  }
}
