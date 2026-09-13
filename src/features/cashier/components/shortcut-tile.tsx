import { memo, type PointerEvent } from "react"
import { Button, type PressEvent } from "@heroui/react"
import { Pin, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ShortcutProduct } from "@/features/products/types"
import { formatRupiah } from "../utils"

interface ShortcutTileProps {
  product: ShortcutProduct
  /** `true` selama pin produk ini ditahan untuk dilepas. */
  isHolding: boolean
  /** Kemajuan tahanan dalam persen; `0` untuk ubin yang tidak sedang ditahan. */
  holdProgress: number
  onSelect: (product: ShortcutProduct) => void
  onTogglePin: (productId: number) => void
  onHoldStart: (event: PointerEvent, productId: number) => void
  onHoldCancel: () => void
}

/** Merah yang menguat seiring tahanan, dari token `--danger`. */
function holdTint(percent: number, over: string) {
  return `color-mix(in srgb, var(--danger) ${percent}%, ${over})`
}

/**
 * Satu ubin di tab Favorit: nama produk, harganya, dan pin di pojok.
 *
 * **Kenapa `Button` dan bukan `Card`.** API `Card` HeroUI v3 hanya
 * `variant`/`className`/`children` — tidak ada bentuk pressable-nya, dan bagian
 * Accessibility dokumentasinya justru menyuruh memasang `cardVariants().base()`
 * pada elemen interaktif milik sendiri. Ubin ini sudah berupa aksi (menambah ke
 * keranjang), jadi komponen yang tepat adalah `Button`. Ia juga harus memuat
 * kontrol kedua (pin), dan satu kartu pressable akan membuat tombol di dalam
 * tombol; karena itu pin digambar sebagai `Button` **bersaudara** yang
 * ditumpuk di pojok, bukan `span role="button"` di dalam ubinnya.
 *
 * Bentuk ubinnya — mengisi sel, sudut kartu, teks yang boleh membungkus —
 * datang dari kelas `.tile` di `index.css`, dipakai bersama ubin layanan PPOB.
 *
 * `memo` bukan hiasan: selama pin ditahan, `holdProgress` diperbarui tiap 16ms,
 * dan tanpa ini ketiga puluh ubinnya ikut dirender ulang setiap tik.
 */
export const ShortcutTile = memo(function ShortcutTile({
  product,
  isHolding,
  holdProgress,
  onSelect,
  onTogglePin,
  onHoldStart,
  onHoldCancel,
}: ShortcutTileProps) {
  const isPinned = product.is_pinned

  return (
    <div className="group relative h-full">
      {/* `pe-9` menyisakan kolom selebar pin di kanan, supaya nama dan harga
          tidak pernah tertimpa kontrol yang menumpuk di atasnya. */}
      <Button
        className="tile flex-col items-start justify-start gap-1 px-3 py-2.5 pe-9 text-left"
        style={
          isHolding
            ? {
                borderColor: holdTint(holdProgress, "var(--border)"),
                backgroundColor: holdTint(holdProgress * 0.15, "transparent"),
                boxShadow: `0 0 0 1px ${holdTint(holdProgress * 0.5, "transparent")}`,
              }
            : undefined
        }
        variant="tertiary"
        onPress={() => !isHolding && onSelect(product)}
      >
        <span className="line-clamp-2 w-full break-words">{product.name}</span>
        <span className="w-full text-xs tabular-nums text-muted">
          {formatRupiah(product.sell_price)}
        </span>
      </Button>
      {/* Pin produk yang belum disematkan hanya muncul saat ubinnya disentuh,
          tapi tetap terlihat begitu difokus dari papan ketik — kontrol yang
          hanya muncul saat hover hilang bagi yang bernavigasi dengan Tab. */}
      <Button
        aria-label={isPinned ? `Tahan untuk hapus pin ${product.name}` : `Pin ${product.name}`}
        className={cn(
          "group/pin absolute end-1 top-1 size-7 rounded-full p-0",
          isPinned
            ? "hover:bg-danger/10"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
        isIconOnly
        size="sm"
        variant="tertiary"
        {...(isPinned
          ? {
              onPointerDown: (event: PointerEvent) => onHoldStart(event, product.id),
              onPointerLeave: onHoldCancel,
              onPointerUp: onHoldCancel,
              // Menahan hanya berarti untuk jari dan tetikus. Enter/Spasi sudah
              // merupakan niat yang jelas, jadi papan ketik melepas pin
              // langsung — tanpa ini tombolnya jadi perhentian Tab yang mati.
              onPress: (event: PressEvent) => {
                if (event.pointerType === "keyboard" || event.pointerType === "virtual") {
                  onTogglePin(product.id)
                }
              },
            }
          : { onPress: () => onTogglePin(product.id) })}
      >
        {!isPinned ? (
          <Pin className="size-3 text-muted" />
        ) : isHolding ? (
          <Trash2 className="size-3 text-danger" />
        ) : (
          <>
            <Pin className="size-3 fill-current text-accent opacity-40 group-hover/pin:hidden" />
            <Trash2 className="hidden size-3 text-danger group-hover/pin:block" />
          </>
        )}
      </Button>
    </div>
  )
})
