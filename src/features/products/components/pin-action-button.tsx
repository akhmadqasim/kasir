import { Pin } from "lucide-react"
import { Button, Spinner, Tooltip } from "@heroui/react"

/**
 * Pin produk ke shortcut kasir.
 *
 * Ikonnya sendiri tidak menjelaskan apa-apa, jadi alasannya dulu dititipkan ke
 * atribut `title` — hanya terbaca kalau kursor berhenti di atasnya. Tombolnya
 * aktif, jadi `Tooltip` boleh membungkus `Button` langsung tanpa
 * `Tooltip.Trigger`: pembungkus itu menambah satu titik Tab yang tidak perlu.
 *
 * `isPending` menahan tekan kedua selama permintaan pertama berjalan — tanpa
 * itu klik ganda mem-pin lalu langsung melepasnya lagi.
 */
export function PinActionButton({
  isPinned,
  isPending = false,
  productName,
  onPress,
}: {
  isPinned: boolean
  isPending?: boolean
  productName: string
  onPress: () => void
}) {
  // Nama aksesibelnya tetap dan `aria-pressed` yang menyatakan keadaannya —
  // pola tombol toggle. Tooltip yang terlihat boleh menyebut apa yang akan terjadi.
  const hint = isPinned ? "Hapus pin shortcut" : "Pin ke shortcut kasir"

  return (
    <Tooltip>
      <Button
        aria-label={`Pin ${productName} ke shortcut kasir`}
        aria-pressed={isPinned}
        isIconOnly
        isPending={isPending}
        preventFocusOnPress
        size="sm"
        variant="tertiary"
        onPress={onPress}
      >
        {({ isPending: pending }) =>
          pending ? (
            <Spinner color="current" size="sm" />
          ) : (
            <Pin className={isPinned ? "fill-current text-accent-soft-foreground" : undefined} />
          )
        }
      </Button>
      <Tooltip.Content>{hint}</Tooltip.Content>
    </Tooltip>
  )
}
