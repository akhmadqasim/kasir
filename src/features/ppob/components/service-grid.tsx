import { cn } from "@/lib/utils"
import { PPOB_SERVICE_COLORS, type PpobServiceDef } from "../constants"
import { TileButton } from "./tile-button"
import { TileGrid } from "./tile-grid"

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
    <TileGrid compact={compact}>
      {services.map((service) => (
        // Bentuk ubinnya `TileButton` (kelas `.tile` di `index.css`), sama
        // dengan ubin grup/biller Payment Point dan hasil pencarian.
        <TileButton
          key={service.key}
          compact={compact}
          icon={
            <service.icon
              className={cn(compact ? "size-5" : "size-6", PPOB_SERVICE_COLORS[service.key].text)}
            />
          }
          label={service.label}
          onPress={() => onSelect(service)}
        />
      ))}
    </TileGrid>
  )
}
