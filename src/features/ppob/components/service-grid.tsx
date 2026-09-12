import { Button } from "@heroui/react"

import { cn } from "@/lib/utils"
import { PPOB_SERVICE_COLORS, type PpobServiceDef } from "../constants"

interface ServiceGridProps<S extends PpobServiceDef> {
  services: readonly S[]
  onSelect: (service: S) => void
  /**
   * Kisi di panel kasir: ubin lebih rapat dan ikonnya lebih kecil, karena
   * berbagi lebar dengan keranjang di sebelahnya.
   */
  compact?: boolean
}

/**
 * Kisi ubin layanan PPOB — satu bentuk untuk halaman PPOB dan panel kasir.
 * Warna ikon per layanan datang dari `PPOB_SERVICE_COLORS` (DESIGN.md §3.2).
 */
export function ServiceGrid<S extends PpobServiceDef>({
  services,
  onSelect,
  compact = false,
}: ServiceGridProps<S>) {
  return (
    <div
      className={cn(
        "grid grid-cols-3 sm:grid-cols-4",
        compact ? "gap-2 lg:grid-cols-6" : "gap-3 lg:grid-cols-5 xl:grid-cols-6",
      )}
    >
      {services.map((service) => (
        <Button
          key={service.key}
          className={cn(
            "h-auto flex-col whitespace-normal",
            compact ? "gap-1.5 py-3" : "gap-2 py-4",
          )}
          variant="secondary"
          onPress={() => onSelect(service)}
        >
          <service.icon
            className={cn(compact ? "size-5" : "size-6", PPOB_SERVICE_COLORS[service.key].text)}
          />
          <span className="text-center">{service.label}</span>
        </Button>
      ))}
    </div>
  )
}
