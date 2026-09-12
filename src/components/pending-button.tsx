import type { ReactNode } from "react"
import { Button, Spinner, type ButtonProps } from "@heroui/react"

export interface PendingButtonProps extends Omit<ButtonProps, "children" | "isPending"> {
  /** `true` selama mutasi berjalan: spinner muncul di kiri label, tombol tidak menerima klik. */
  isPending?: boolean
  /** Label tetap — tidak berganti jadi "Menyimpan..." saat menunggu. */
  children: ReactNode
}

/**
 * Tombol yang menunggu hasil mutasi.
 *
 * Idiomnya adalah render-prop yang dipakai dokumentasi `Button` HeroUI —
 * `isPending` dari React Aria plus `Spinner color="current"` di dalam anaknya —
 * ditulis satu kali. Sebelumnya ada tiga cara di ~25 tempat: idiom ini, ikon
 * `Loader2 animate-spin` warisan shadcn, dan label yang berganti menjadi
 * "Memproses...". Yang terakhir paling buruk: lebar tombol berubah saat
 * ditekan, dan barisan tombol di footer dialog ikut bergeser.
 *
 * Labelnya sengaja tetap. `isPending` React Aria sudah memberi tahu pembaca
 * layar bahwa tombolnya sedang sibuk, dan spinner sudah mengatakannya pada
 * mata; mengganti kata-katanya hanya mengulang informasi yang sama sambil
 * merusak tata letak.
 */
export function PendingButton({ isPending = false, children, ...props }: PendingButtonProps) {
  return (
    <Button isPending={isPending} {...props}>
      {({ isPending: pending }) => (
        <>
          {pending ? <Spinner color="current" size="sm" /> : null}
          {children}
        </>
      )}
    </Button>
  )
}
