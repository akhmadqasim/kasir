import type { ReactNode } from "react"
import { Chip, type ChipRootProps } from "@heroui/react"

/**
 * The one place the app decides what a status looks like.
 *
 * Screens name the *meaning* — success, error, warning — and this maps it onto
 * HeroUI's colour scale. Nothing outside this file should reach for a Tailwind
 * colour class for a status: `bg-green-50 text-green-700` has no dark-mode story
 * of its own and drifts between screens, which is exactly what it used to do here.
 */
export type StatusVariant = "success" | "error" | "warning" | "info" | "neutral"

const STATUS_COLOR: Record<StatusVariant, ChipRootProps["color"]> = {
  success: "success",
  // HeroUI calls the red one `danger`.
  error: "danger",
  warning: "warning",
  info: "accent",
  neutral: "default",
}

interface StatusBadgeProps extends Omit<ChipRootProps, "color" | "children"> {
  status: StatusVariant
  children: ReactNode
}

export function StatusBadge({ status, variant = "soft", ...props }: StatusBadgeProps) {
  return <Chip color={STATUS_COLOR[status]} variant={variant} {...props} />
}
