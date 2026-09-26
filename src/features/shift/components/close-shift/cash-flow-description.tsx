import { Tooltip } from "@heroui/react"

/**
 * The description is truncated, so the tooltip is the only way to read a long
 * one — but it explains *text*, not a control. `Tooltip.Trigger` would otherwise
 * wrap it in `div[role=button][tabindex=0]` and put a tab stop on every row,
 * between the row above and the delete button beside it. The render function
 * drops both attributes and keeps the hover handlers, which is what the Radix
 * `asChild` trigger did.
 */
export function CashFlowDescription({ description }: { description: string }) {
  return (
    <Tooltip>
      <Tooltip.Trigger<"span">
        render={({ role: _role, tabIndex: _tabIndex, className, ...domProps }) => (
          <span {...domProps} className={`min-w-0 truncate text-sm text-muted ${className ?? ""}`}>
            {description}
          </span>
        )}
      />
      <Tooltip.Content placement="top">
        <p className="max-w-xs">{description}</p>
      </Tooltip.Content>
    </Tooltip>
  )
}
