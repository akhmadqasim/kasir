import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type StatusVariant = "success" | "error" | "warning" | "info" | "neutral"

const variantClasses: Record<StatusVariant, string> = {
  success: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  error: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  warning: "border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  info: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  neutral: "border-border bg-muted text-muted-foreground",
}

interface StatusBadgeProps extends React.ComponentProps<"span"> {
  status: StatusVariant
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(variantClasses[status], className)}
      {...props}
    />
  )
}

/** Extra color variant for "orange" used by stock writeoff expired reason */
const extraClasses = {
  orange: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300",
}

interface ColorBadgeProps extends React.ComponentProps<"span"> {
  color: StatusVariant | keyof typeof extraClasses
}

export function ColorBadge({ color, className, ...props }: ColorBadgeProps) {
  const cls = color in variantClasses
    ? variantClasses[color as StatusVariant]
    : extraClasses[color as keyof typeof extraClasses]
  return (
    <Badge
      variant="outline"
      className={cn(cls, className)}
      {...props}
    />
  )
}
