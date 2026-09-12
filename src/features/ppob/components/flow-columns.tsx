import type { ReactNode } from "react"

/**
 * Dua kolom flow PPOB di layar lebar: isian di kiri, ringkasan yang menempel
 * saat digulir di kanan. Di bawah `lg` keduanya bertumpuk, karena layar yang
 * sama dibuka dari ponsel di jaringan toko.
 */
export function FlowColumns({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-8">{children}</div>
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-6">{aside}</div>
      </div>
    </div>
  )
}
