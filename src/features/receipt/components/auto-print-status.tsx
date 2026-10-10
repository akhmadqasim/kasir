import { Spinner } from "@heroui/react"
import { Printer, TriangleAlert } from "lucide-react"

import type { AutoPrintState } from "../hooks/use-receipt-print"

/**
 * One line on how the automatic print went; nothing while idle. Meant for the
 * caller's live region, so each change is announced.
 */
export function AutoPrintStatus({ state }: { state: AutoPrintState }) {
  switch (state.status) {
    case "printing":
      return (
        <p className="flex items-center gap-2">
          <Spinner color="current" size="sm" />
          Struk sedang dicetak otomatis…
        </p>
      )
    case "printed":
      return (
        <p className="flex items-center gap-2">
          <Printer aria-hidden="true" className="size-4 shrink-0" />
          Struk otomatis dicetak.
        </p>
      )
    case "failed":
      return (
        <p className="flex items-start gap-2 text-danger">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Struk gagal dicetak otomatis: {state.message.replace(/[.\s]+$/, "")}. Gunakan tombol
            &quot;Cetak struk&quot;.
          </span>
        </p>
      )
    default:
      return null
  }
}
