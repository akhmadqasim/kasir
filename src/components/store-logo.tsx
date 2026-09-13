import { Avatar } from "@heroui/react"
import { LogoRustore } from "@gravity-ui/icons"

import type { StoreInfo } from "@/features/settings/types"
import { storeLogoUrl } from "@/lib/api/settings"

interface StoreLogoProps {
  store: Pick<StoreInfo, "name" | "logo_path" | "updated_at"> | null | undefined
  /** Size classes for the `Avatar`; the fallback icon scales with it. */
  className?: string
}

/**
 * The store's brand mark: the uploaded logo when there is one, otherwise the
 * Gravity UI `LogoRustore` glyph. Drawn the same way in the sidebar header and
 * in the settings preview, so what the owner uploads is what they see.
 *
 * `Avatar.Fallback` also covers a logo whose file has gone missing — HeroUI
 * shows it while the image loads and keeps it if the load fails.
 */
export function StoreLogo({ store, className }: StoreLogoProps) {
  const src = storeLogoUrl(store ?? null)

  return (
    <Avatar className={className}>
      {src && <Avatar.Image alt={store?.name ?? ""} src={src} />}
      <Avatar.Fallback>
        <LogoRustore aria-hidden="true" className="size-[45%]" />
      </Avatar.Fallback>
    </Avatar>
  )
}
