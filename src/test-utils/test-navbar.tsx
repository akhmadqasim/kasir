import { useMemo, useState, type ReactNode } from "react"

import { NavbarContext } from "@/components/layout/navbar-context"

/**
 * Navbar tiruan untuk test yang merender satu halaman tanpa `AppLayout`.
 *
 * Halaman memasang judul dan aksinya lewat portal ke slot navbar, jadi tanpa
 * slot isinya tidak pernah tergambar dan `screen.getByRole` tidak menemukan
 * tombol apa pun. Dua `div` di sini adalah slot itu, ditaruh di pohon DOM
 * yang sama dengan halamannya. Menyediakan ini di test — bukan menambah
 * cabang "kalau tidak ada navbar, gambar di tempat" di kode produksi — menjaga
 * komponen navbar hanya punya satu jalur.
 */
export function TestNavbar({ children }: { children: ReactNode }) {
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ titleSlot, actionsSlot }), [titleSlot, actionsSlot])

  return (
    <NavbarContext.Provider value={slots}>
      <div ref={setTitleSlot} />
      <div ref={setActionsSlot} />
      {children}
    </NavbarContext.Provider>
  )
}
