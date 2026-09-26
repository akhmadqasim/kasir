import { useState } from "react"
import { Building2, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface PaymentPointIconProps {
  /** A group or biller's own icon URL, or `null` when Mitra sent none. */
  pathIcon: string | null
  className: string
  /**
   * The glyph shown when there is no usable image, and its colour class —
   * a voucher group falls back to its own ticket in the voucher colour, not
   * to a building.
   */
  fallback?: LucideIcon
  fallbackClassName?: string
}

/**
 * A payment-point group or biller's own icon — or a generic building glyph
 * when Mitra sent none, or when the URL it sent does not load. The latter is
 * the normal case for billers: every `path_icon` under
 * `/storage/images/sub_menu_pp/` answers 403 (the group icons under
 * `/images/pp/` do load), so without the fallback the tiles show the
 * browser's broken-image glyph. One place for the fallback, used by every
 * tile that draws from `path_icon`: the group and biller steps in `pp/`,
 * the biller results in `search-results-grid.tsx`, and the voucher groups.
 */
export function PaymentPointIcon({
  pathIcon,
  className,
  fallback: Fallback = Building2,
  fallbackClassName = "text-muted",
}: PaymentPointIconProps) {
  const [failed, setFailed] = useState(false)

  return pathIcon && !failed ? (
    <img
      alt=""
      className={cn(className, "object-contain")}
      src={pathIcon}
      onError={() => setFailed(true)}
    />
  ) : (
    <Fallback aria-hidden="true" className={cn(className, fallbackClassName)} />
  )
}
