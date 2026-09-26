import { useId, type ReactNode } from "react"

interface OptionGroupProps {
  /** Visible heading of the choices — "Nominal", "Pilih produk". */
  label: string
  /** Grid classes for the buttons. */
  className: string
  children: ReactNode
}

/**
 * A labelled set of `ToggleButton`s (denominations, products). The heading
 * names the group for a screen reader too — a bare `<p>` above a grid of
 * buttons announced forty prices with nothing saying what they were prices of.
 */
export function OptionGroup({ label, className, children }: OptionGroupProps) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground" id={labelId}>
        {label}
      </span>
      <div aria-labelledby={labelId} className={className} role="group">
        {children}
      </div>
    </div>
  )
}
