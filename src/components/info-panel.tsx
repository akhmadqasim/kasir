import type { ReactNode } from "react"
import { Surface } from "@heroui/react"

import { cn } from "@/lib/utils"

/**
 * Kotak info di dalam dialog: ringkasan barang yang akan diubah, saldo yang
 * akan dipakai, peringatan sebelum menghapus.
 *
 * Lima dialog pernah menulisnya dengan lima cara — `Surface` ber-`rounded-xl`,
 * `Surface` ber-`rounded-2xl`, `div` ber-`bg-default`, kotak `border-dashed`,
 * dan `Alert`. Ini satu-satunya bentuk yang tersisa: `Surface
 * variant="secondary"` dengan `p-3` dan `text-sm`. Sudutnya tidak ditulis di
 * sini; ia datang dari aturan `.surface` di `index.css`, sama dengan kartu.
 *
 * Bukan `Alert`: `Alert` untuk pesan yang punya status (gagal, berhasil,
 * peringatan) dan ikon; kotak ini cuma menaruh sekumpulan fakta di permukaan
 * yang sedikit berbeda dari latar dialog supaya terlihat sebagai satu benda.
 */
export function InfoPanel({ children, className }: { children: ReactNode; className?: string }) {
  // `className` hanya untuk menyusun isinya (`flex flex-col gap-1`, `divide-y`).
  // Padding dan ukuran huruf ditulis setelahnya supaya `twMerge` memenangkan
  // keduanya — kotak info yang paddingnya berbeda-beda adalah yang baru dibuang.
  return (
    <Surface className={cn(className, "p-3 text-sm")} variant="secondary">
      {children}
    </Surface>
  )
}
