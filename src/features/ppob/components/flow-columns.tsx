import type { ReactNode } from "react"

/**
 * Dua kolom flow PPOB di layar lebar: isian di kiri, ringkasan yang menempel
 * saat digulir di kanan. Di bawah `lg` keduanya bertumpuk, karena layar yang
 * sama dibuka dari ponsel di jaringan toko.
 *
 * `top-0`, bukan `top-6`: wadah gulir `AppLayout` hanya punya `pt-2`, jadi
 * `top-6` mendorong kolom kanan 16px lebih rendah dari kartu kiri bahkan
 * sebelum halaman digulir. Beranda PPOB memakai `top-0` untuk alasan yang sama.
 */
export function FlowColumns({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-8">{children}</div>
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-0">{aside}</div>
      </div>
    </div>
  )
}
