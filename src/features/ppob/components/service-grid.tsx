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
    // `auto-rows-fr` menyamakan tinggi ubin sebaris; tanpanya label dua baris
    // membuat satu ubin lebih tinggi dari tetangganya.
    //
    // Keduanya memakai `auto-fill`, bukan breakpoint viewport: lebar kisi
    // ditentukan panelnya — panel kasir, atau separuh beranda PPOB di sebelah
    // riwayat — jadi `lg:grid-cols-6` yang menyala di layar lebar justru
    // memerasnya jadi enam kolom sempit.
    <div
      className={cn(
        "grid auto-rows-fr",
        compact
          ? "grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2"
          : "grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3",
      )}
    >
      {services.map((service) => (
        // Bentuk ubinnya dari kelas `.tile` (`index.css`), sama dengan ubin
        // Favorit di tab sebelahnya.
        <Button
          key={service.key}
          className={cn("tile flex-col px-2", compact ? "gap-1.5 py-3" : "gap-2 py-4")}
          variant="secondary"
          onPress={() => onSelect(service)}
        >
          <service.icon
            className={cn(compact ? "size-5" : "size-6", PPOB_SERVICE_COLORS[service.key].text)}
          />
          <span className="line-clamp-2 w-full text-center break-words">{service.label}</span>
        </Button>
      ))}
    </div>
  )
}
