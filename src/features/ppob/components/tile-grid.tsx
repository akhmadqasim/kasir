import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface TileGridProps {
  children: ReactNode
  /** Kisi di panel kasir: ubin lebih rapat, karena berbagi lebar dengan keranjang di sebelahnya. */
  compact?: boolean
}

/**
 * The grid every `TileButton` kisi sits in — the fixed service menu, the
 * payment-point group/biller steps, and the search results.
 *
 * `auto-rows-fr` menyamakan tinggi ubin sebaris; tanpanya label dua baris
 * membuat satu ubin lebih tinggi dari tetangganya. Keduanya memakai
 * `auto-fill`, bukan breakpoint viewport: lebar kisi ditentukan panelnya —
 * panel kasir, atau separuh beranda PPOB di sebelah riwayat — jadi
 * `lg:grid-cols-6` yang menyala di layar lebar justru memerasnya jadi enam
 * kolom sempit.
 */
export function TileGrid({ children, compact = false }: TileGridProps) {
  return (
    <div
      className={cn(
        "grid auto-rows-fr",
        compact
          ? "grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2"
          : "grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3",
      )}
    >
      {children}
    </div>
  )
}
