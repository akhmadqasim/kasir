import { useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useLocation } from "react-router-dom"
import { Button } from "@heroui/react"
import { PanelLeftIcon } from "lucide-react"

import { pageTitleFor } from "@/app/navigation"
import { NavbarContext, useNavbarSlots } from "./navbar-context"
import { useSidebar } from "./sidebar-context"

const TITLE_CLASS = "min-w-0 truncate text-xl font-semibold"

/**
 * Bilah 64px di atas setiap halaman: tombol lipat sidebar, judul halaman, dan
 * slot aksi di kanan — susunan `navbar__header` template dashboard HeroUI Pro.
 *
 * Tombol lipatnya pindah ke sini dari kepala sidebar. Di template, kontrol
 * yang mengubah tata letak halaman duduk di halaman, bukan di panel yang akan
 * dilipatnya sendiri; dan di ponsel tombol yang sama membuka drawer, sehingga
 * tombol menu terpisah di pojok bawah layar tidak diperlukan lagi.
 *
 * Judul bawaan diturunkan dari rute lewat daftar navigasi. Halaman yang mau
 * judul lain (dashboard menyapa kasir) memasangnya lewat `NavbarTitle`, yang
 * portal ke slot judul; begitu slot itu terisi, CSS menyembunyikan judul
 * bawaan di sebelahnya. Tidak ada state yang menyinkronkan keduanya.
 */
export function AppNavbar({ children }: { children: ReactNode }) {
  const { toggleSidebar, hoverExpanded, pinSidebar } = useSidebar()
  const location = useLocation()
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const fallbackTitle = pageTitleFor(location.pathname)

  // Konteks sidebar berubah setiap hover dan setiap lipat; tanpa memo, objek
  // baru di sini ikut merender ulang judul dan aksi halaman yang tidak berubah.
  const slots = useMemo(() => ({ titleSlot, actionsSlot }), [titleSlot, actionsSlot])

  // Saat sidebar hanya mengembang karena pointer sedang di atasnya, tombol ini
  // menyematkannya alih-alih melipatnya — perilaku yang dulu dimiliki tombol di
  // kepala sidebar, dan satu-satunya cara mengubah "lirik" menjadi "buka".
  const handleToggle = () => (hoverExpanded ? pinSidebar() : toggleSidebar())

  return (
    <NavbarContext.Provider value={slots}>
      <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 bg-background px-6">
        <Button
          isIconOnly
          aria-label={hoverExpanded ? "Sematkan sidebar" : "Lipat sidebar"}
          size="sm"
          variant="tertiary"
          onPress={handleToggle}
        >
          <PanelLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* `display: contents` membuat judul yang di-portal ke sini ikut jadi
              anak flex dari pembungkusnya; `:empty` pada slot inilah yang
              menyembunyikan judul bawaan di sebelahnya. */}
          <div ref={setTitleSlot} data-slot="navbar-title" className="contents" />
          {fallbackTitle ? (
            <h1 className={`${TITLE_CLASS} [[data-slot=navbar-title]:not(:empty)~&]:hidden`}>
              {fallbackTitle}
            </h1>
          ) : null}
        </div>
        <div ref={setActionsSlot} className="flex items-center gap-2" />
      </header>
      {children}
    </NavbarContext.Provider>
  )
}

/**
 * Judul halaman yang menggantikan judul bawaan rute.
 *
 * `leading` digambar di kiri judul, di luar `<h1>` — tempat tombol kembali
 * sub-halaman. Tombol di dalam heading merusak semantiknya; di sebelahnya, ia
 * duduk persis di posisi tombol lipat sidebar, jadi mata sudah tahu tempatnya.
 */
export function NavbarTitle({ children, leading }: { children: ReactNode; leading?: ReactNode }) {
  const { titleSlot } = useNavbarSlots()
  if (!titleSlot) return null
  return createPortal(
    <>
      {leading}
      <h1 className={TITLE_CLASS}>{children}</h1>
    </>,
    titleSlot,
  )
}

/** Aksi halaman di ujung kanan navbar. */
export function NavbarActions({ children }: { children: ReactNode }) {
  const { actionsSlot } = useNavbarSlots()
  if (!actionsSlot) return null
  return createPortal(children, actionsSlot)
}
