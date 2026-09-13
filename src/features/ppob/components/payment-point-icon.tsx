import { useState } from "react"
import { Building2 } from "lucide-react"

import { cn } from "@/lib/utils"

interface PaymentPointIconProps {
  /** A group or biller's own icon URL, or `null` when Mitra sent none. */
  pathIcon: string | null
  className: string
}

/**
 * A payment-point group or biller's own icon — or a generic building glyph
 * when Mitra sent none, or when the URL it sent does not load. The latter is
 * the normal case for billers: every `path_icon` under
 * `/storage/images/sub_menu_pp/` answers 403 (the group icons under
 * `/images/pp/` do load), so without the fallback the tiles show the
 * browser's broken-image glyph. One place for the fallback, used by every
 * tile that draws from `path_icon`: the group and biller steps in
 * `pp-flow.tsx`, and the biller results in `search-results-grid.tsx`.
 */
export function PaymentPointIcon({ pathIcon, className }: PaymentPointIconProps) {
  const [failed, setFailed] = useState(false)

  return pathIcon && !failed ? (
    <img alt="" className={className} src={pathIcon} onError={() => setFailed(true)} />
  ) : (
    <Building2 className={cn(className, "text-muted")} />
  )
}
