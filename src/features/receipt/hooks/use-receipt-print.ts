import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react"

import { useSingleFlight } from "@/hooks/use-single-flight"
import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { printReceipt } from "@/lib/api/printers"
import { flashPress } from "@/lib/flash-press"
import { createShortcutScanFilter } from "@/lib/scanner-burst"
import { toast } from "@/lib/toast"

export type AutoPrintState =
  | { status: "idle" }
  | { status: "printing" }
  | { status: "printed" }
  | { status: "failed"; message: string }

export interface ReceiptShortcut {
  run: () => unknown
  /** The button that flashes "pressed" when the key runs it. */
  buttonRef: RefObject<HTMLButtonElement | null>
}

interface UseReceiptPrintOptions {
  /** Starts one quiet print the first time it is `true`. */
  autoPrint?: boolean
  /** Runs after the auto-print succeeded, while still mounted. */
  onAutoPrinted?: () => void
  /**
   * Window-wide keys while mounted: Enter prints, plus these (lower-case key).
   * Leave out for no keys at all.
   */
  shortcuts?: Record<string, ReceiptShortcut>
}

/**
 * Prints a sale's struk: by the button, once automatically, and by Enter. One
 * print runs at a time, and the Enter that closes a barcode scan prints nothing.
 */
export function useReceiptPrint(
  transactionId: number,
  { autoPrint = false, onAutoPrinted, shortcuts }: UseReceiptPrintOptions = {},
) {
  const { isPending: isPrinting, run } = useSingleFlight()
  const [autoPrintState, setAutoPrintState] = useState<AutoPrintState>({ status: "idle" })
  // Once per struk, also when StrictMode runs the effect twice.
  const autoPrintStartedRef = useRef(false)
  // The component's lifetime, not one run of an effect: StrictMode's second
  // run must still see the result of the print the first run started.
  const unmountedRef = useRef(false)
  const printButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const print = () =>
    run(async () => {
      try {
        await printReceipt(transactionId)
        toast.success(id.print.printed)
      } catch (error) {
        const message = errorMessage(error)
        toast.error(
          message.includes("belum dikonfigurasi")
            ? id.print.printerNotSet
            : id.print.failed(message),
        )
      }
    })

  const reportAutoPrinted = useEffectEvent(() => onAutoPrinted?.())
  useEffect(() => {
    if (!autoPrint || autoPrintStartedRef.current) return
    autoPrintStartedRef.current = true
    // Under the same guard as the button, so Enter meanwhile is not a second struk.
    void run(
      async () => {
        setAutoPrintState({ status: "printing" })
        try {
          await printReceipt(transactionId)
          if (unmountedRef.current) return
          setAutoPrintState({ status: "printed" })
          reportAutoPrinted()
        } catch (error) {
          if (unmountedRef.current) return
          setAutoPrintState({ status: "failed", message: errorMessage(error) })
        }
      },
      { quiet: true },
    )
  }, [autoPrint, run, transactionId])

  const runShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action =
      event.key === "Enter"
        ? { run: print, buttonRef: printButtonRef }
        : shortcuts?.[event.key.toLowerCase()]
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    // A held key repeats: one press, one struk.
    if (event.repeat) return
    flashPress(action.buttonRef.current)
    void action.run()
  })
  const hasShortcuts = shortcuts !== undefined
  useEffect(() => {
    if (!hasShortcuts) return
    const isScanEnter = createShortcutScanFilter()
    // Capture phase, so a button that happens to have focus is not pressed too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return
      }
      // The next customer's item scanned before the dialog closes is no reprint.
      if (isScanEnter(event)) {
        toast.warning(id.cashier.scanIgnoredAfterSale)
        return
      }
      runShortcut(event)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [hasShortcuts])

  return { isPrinting, print, autoPrintState, printButtonRef }
}
