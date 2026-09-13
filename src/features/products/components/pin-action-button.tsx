import { Pin } from "lucide-react"
import { Button, Tooltip } from "@heroui/react"

/**
 * Pin produk ke shortcut kasir.
 *
 * Ikonnya sendiri tidak menjelaskan apa-apa, jadi alasannya dulu dititipkan ke
 * atribut `title` — hanya terbaca kalau kursor berhenti di atasnya. Tombolnya
 * aktif, jadi `Tooltip` boleh membungkus `Button` langsung tanpa
 * `Tooltip.Trigger`: pembungkus itu menambah satu titik Tab yang tidak perlu.
 */
export function PinActionButton({ isPinned, onPress }: { isPinned: boolean; onPress: () => void }) {
  const label = isPinned ? "Hapus pin shortcut" : "Pin ke shortcut kasir"

  return (
    <Tooltip>
      <Button
        aria-label={label}
        isIconOnly
        preventFocusOnPress
        size="sm"
        variant="tertiary"
        onPress={onPress}
      >
        <Pin className={isPinned ? "fill-current text-accent" : undefined} />
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}
