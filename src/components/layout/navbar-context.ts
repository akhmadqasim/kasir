import { createContext, useContext } from "react"

/**
 * Slot DOM milik navbar, dibagikan ke halaman lewat context.
 *
 * Halaman mengisi judul dan aksinya dengan portal ke elemen ini, bukan dengan
 * menaruh ReactNode di state bersama. Menyimpan JSX di state berarti setiap
 * render halaman membuat identitas baru, memicu setState, memicu render lagi —
 * lingkaran yang cuma bisa diputus dengan memoisasi di setiap pemanggil. Slot
 * DOM ditetapkan sekali saat navbar terpasang dan tidak pernah berubah, dan
 * tidak ada state lain di sini: apakah slot judul terisi dijawab CSS `:empty`
 * di `AppNavbar`, bukan oleh flag yang harus disinkronkan dari komponen anak.
 */
export interface NavbarSlots {
  titleSlot: HTMLElement | null
  actionsSlot: HTMLElement | null
}

export const NavbarContext = createContext<NavbarSlots | null>(null)

/**
 * Di luar `AppLayout` ini melempar, seperti `useSidebar`. Test yang merender
 * satu halaman memakai `TestNavbar` dari `test-utils`, bukan fallback di kode
 * produksi.
 */
export function useNavbarSlots(): NavbarSlots {
  const slots = useContext(NavbarContext)
  if (!slots) {
    throw new Error("NavbarTitle/NavbarActions must be rendered inside <AppNavbar>.")
  }
  return slots
}
