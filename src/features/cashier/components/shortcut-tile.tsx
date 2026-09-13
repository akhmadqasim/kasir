import { memo } from "react"
import { Button } from "@heroui/react"

import type { ShortcutProduct } from "@/features/products/types"
import { formatRupiah } from "../utils"

interface ShortcutTileProps {
  product: ShortcutProduct
  onSelect: (product: ShortcutProduct) => void
}

/**
 * Satu ubin di tab Favorit: nama produk dan harganya. Pin/lepas pin diatur
 * dari halaman Produk, bukan dari sini — di meja kasir ubin ini hanya satu
 * aksi, menambah ke keranjang.
 *
 * **Kenapa `Button` dan bukan `Card`.** API `Card` HeroUI v3 hanya
 * `variant`/`className`/`children` — tidak ada bentuk pressable-nya, dan bagian
 * Accessibility dokumentasinya justru menyuruh memasang `cardVariants().base()`
 * pada elemen interaktif milik sendiri. Ubin ini sudah berupa aksi, jadi
 * komponen yang tepat adalah `Button`.
 *
 * Bentuk ubinnya — mengisi sel, sudut kartu, teks yang boleh membungkus —
 * datang dari kelas `.tile` di `index.css`, dipakai bersama ubin layanan PPOB.
 *
 * `memo`: tiga puluh ubin ini tidak perlu ikut dirender ulang tiap kali kolom
 * pencarian di atasnya berubah.
 */
export const ShortcutTile = memo(function ShortcutTile({ product, onSelect }: ShortcutTileProps) {
  return (
    <Button
      className="tile min-h-24 flex-col items-start justify-start gap-1.5 px-4 py-3.5 text-left"
      variant="tertiary"
      onPress={() => onSelect(product)}
    >
      <span className="line-clamp-2 w-full break-words">{product.name}</span>
      <span className="w-full text-xs tabular-nums text-muted">
        {formatRupiah(product.sell_price)}
      </span>
    </Button>
  )
})
