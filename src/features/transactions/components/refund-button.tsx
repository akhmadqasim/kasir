import { Button, Tooltip, type ButtonProps } from "@heroui/react"

interface RefundButtonProps extends Omit<ButtonProps, "isDisabled"> {
  /** Why the refund is not allowed (e.g. past the seven-day window), or `null`. */
  blockedReason: string | null
}

/**
 * Refund entry point. Past the seven-day window the backend rejects the refund
 * outright, so the button is disabled here with the reason attached. A disabled
 * button swallows pointer events, so the tooltip has to hang off a wrapper:
 * HeroUI's `Tooltip.Trigger` renders it as `div[role=button][tabindex=0]`, which
 * also makes the reason reachable by keyboard — the old `<span>` wrapper was
 * invisible to anyone not using a mouse.
 */
export function RefundButton({ blockedReason, ...buttonProps }: RefundButtonProps) {
  const button = <Button {...buttonProps} isDisabled={blockedReason !== null} />

  if (!blockedReason) return button

  return (
    <Tooltip>
      <Tooltip.Trigger className="inline-flex">{button}</Tooltip.Trigger>
      <Tooltip.Content>{blockedReason}</Tooltip.Content>
    </Tooltip>
  )
}
