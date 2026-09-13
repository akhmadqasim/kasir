import { Building2 } from "lucide-react"

import { cn } from "@/lib/utils"

interface PaymentPointIconProps {
  /** A group or biller's own icon URL, or `null` when Mitra sent none. */
  pathIcon: string | null
  className: string
}

/**
 * A payment-point group or biller's own icon — or a generic building glyph
 * when Mitra sent none. One place for the fallback, used by every tile that
 * draws from `path_icon`: the group and biller steps in `pp-flow.tsx`, and
 * the biller results in `search-results-grid.tsx`.
 */
export function PaymentPointIcon({ pathIcon, className }: PaymentPointIconProps) {
  return pathIcon ? (
    <img alt="" className={className} src={pathIcon} />
  ) : (
    <Building2 className={cn(className, "text-muted")} />
  )
}
