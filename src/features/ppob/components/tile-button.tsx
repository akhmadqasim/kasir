import type { ReactNode } from "react"
import { Button } from "@heroui/react"

import { cn } from "@/lib/utils"

interface TileButtonProps {
  icon?: ReactNode
  label: string
  /** A short muted line under the label — a group name, a biller description. */
  description?: string
  /** A status badge under the label instead of `description` — e.g. "Gangguan". */
  badge?: ReactNode
  /** Kisi lebih rapat, dipakai panel kasir. */
  compact?: boolean
  isDisabled?: boolean
  onPress?: () => void
}

/**
 * One tile: an icon, a label, and an optional description or status badge
 * underneath.
 *
 * The one shape every kisi in `features/ppob` renders — the fixed service
 * menu (`ServiceGrid`), the payment-point group and biller steps, and the
 * search results all draw the same tile so a cashier's eye does not have to
 * learn a second shape for "this is also a thing you can tap". `description`
 * and `badge` are two named slots rather than one slot that guesses its
 * styling from what was passed — a caller always knows which one it means.
 */
export function TileButton({
  icon,
  label,
  description,
  badge,
  compact = false,
  isDisabled = false,
  onPress,
}: TileButtonProps) {
  return (
    <Button
      className={cn("tile flex-col px-2", compact ? "gap-1.5 py-3" : "gap-2 py-4")}
      isDisabled={isDisabled}
      variant="secondary"
      onPress={onPress}
    >
      {icon}
      <span className="line-clamp-2 w-full text-center break-words">{label}</span>
      {description ? (
        <span className="line-clamp-1 w-full text-center text-xs text-muted break-words">
          {description}
        </span>
      ) : null}
      {badge ? <span className="flex w-full items-center justify-center">{badge}</span> : null}
    </Button>
  )
}
