import { Kbd } from "@heroui/react"

interface ShortcutKeyProps {
  children: string
  className?: string
  variant?: "light"
}

/**
 * Tombol pintasan di dalam tombol aksinya, setelah label. Di tombol
 * `tertiary` (tanpa latar) dipakai `Kbd` bawaan dengan kotak abu-abunya,
 * seperti contoh di dokumentasi; di tombol utama yang biru, varian `light`
 * supaya tidak ada kotak abu-abu di atas warna aksen. Pengikatan tombolnya:
 * F1/F2/F3/F6/F9 di `CartPanel`, F4 di `CashierPage`.
 *
 * Spasi di depannya ikut nama aksesibel tombolnya — "Diskon F2", bukan
 * "DiskonF2" — dan tidak menambah jarak di layar karena tombolnya flex.
 * (`aria-keyshortcuts` tidak bisa dipakai: React Aria membuangnya dari `Button`.)
 */
export function ShortcutKey({ children, className, variant }: ShortcutKeyProps) {
  return (
    <>
      {" "}
      <Kbd className={className} variant={variant}>
        <Kbd.Content>{children}</Kbd.Content>
      </Kbd>
    </>
  )
}
