import { useEffect, useRef, useState, type KeyboardEvent } from "react"

import { toast } from "@/lib/toast"
import { SCANNER_MAX_ENTER_DELAY_MS, createShortcutScanFilter } from "@/lib/scanner-burst"

interface ScanBurstGuardOptions<T> {
  /** What the field holds now; kept as it was when a burst of digits started. */
  value: T
  /** Puts back the value from before a burst that turned out to be a scan. */
  onRestore: (value: T) => void
  /** The scan-ignored toast for this field. */
  message: string
}

/**
 * Keeps a barcode scanned into a dialog field out of it. Call `handleKeyDown`
 * first in the field's keydown: on a scan's Enter it restores the value, toasts
 * and returns `true`. A field that saves as it is typed saves through `commit`,
 * which holds a typed digit's save until it can no longer be part of a scan.
 */
export function useScanBurstGuard<T>({ value, onRestore, message }: ScanBurstGuardOptions<T>) {
  const [isScanEnter] = useState(createShortcutScanFilter)
  const valueBeforeBurstRef = useRef(value)
  /** Set by a digit's keydown, taken by the change it causes. */
  const digitTypedRef = useRef(false)
  const pendingRef = useRef<(() => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const cancel = () => {
    clearTimeout(timerRef.current)
    pendingRef.current = null
  }

  const flush = () => {
    const pending = pendingRef.current
    cancel()
    pending?.()
  }

  // A save still waiting when the dialog closes is what the cashier typed.
  useEffect(() => {
    const pending = pendingRef
    const timer = timerRef
    return () => {
      clearTimeout(timer.current)
      const save = pending.current
      pending.current = null
      save?.()
    }
  }, [])

  const commit = (save: () => void) => {
    if (!digitTypedRef.current) {
      flush()
      save()
      return
    }
    digitTypedRef.current = false
    clearTimeout(timerRef.current)
    pendingRef.current = save
    timerRef.current = setTimeout(flush, SCANNER_MAX_ENTER_DELAY_MS)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    const isScan = isScanEnter(e, (burst) => {
      if (burst.digits.length === 1) valueBeforeBurstRef.current = value
      digitTypedRef.current = true
    })
    if (e.key !== "Enter") return false
    digitTypedRef.current = false
    if (isScan) {
      cancel()
      onRestore(valueBeforeBurstRef.current)
      toast.warning(message)
      return true
    }
    flush()
    return false
  }

  return { handleKeyDown, commit, cancel }
}
