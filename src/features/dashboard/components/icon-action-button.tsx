import type { ComponentProps, ReactNode } from "react"
import { Button, Spinner, Tooltip } from "@heroui/react"

interface IconActionButtonProps {
  label: string
  icon: ReactNode
  onPress: () => void
  isPending?: boolean
  /** Letak tooltip; bawaan HeroUI bila dilewatkan. */
  tooltipPlacement?: ComponentProps<typeof Tooltip.Content>["placement"]
}

/**
 * Tombol ikon `sm tertiary` dengan tooltip bertulisan yang sama dengan
 * `aria-label`-nya: pembaca layar sudah mendengar namanya, mata perlu melihatnya
 * juga — ikon berjajar tanpa tulisan membuat kasir menebak. Selama `isPending`
 * ikonnya berganti spinner dan tombolnya tidak bisa ditekan dua kali.
 */
export function IconActionButton({
  label,
  icon,
  onPress,
  isPending = false,
  tooltipPlacement,
}: IconActionButtonProps) {
  return (
    <Tooltip delay={300}>
      <Button
        isIconOnly
        aria-label={label}
        isPending={isPending}
        size="sm"
        variant="tertiary"
        onPress={onPress}
      >
        {({ isPending: pending }) => (pending ? <Spinner color="current" size="sm" /> : icon)}
      </Button>
      <Tooltip.Content placement={tooltipPlacement}>{label}</Tooltip.Content>
    </Tooltip>
  )
}
