import { useContext, useEffect } from "react"
import { useLocation, useNavigate, useRouteError } from "react-router-dom"

import { NavbarTitle } from "@/components/layout/app-navbar"
import { NavbarContext } from "@/components/layout/navbar-context"
import { ErrorScreen } from "./error-screen"
import { describeRouteError, resolveHomeAction } from "./route-error"

/**
 * `errorElement` untuk rute-rute di `router.tsx`: menggantikan layar bawaan
 * react-router ("You can provide a way better UX than this...") saat sebuah
 * halaman melempar waktu render, atau saat alamatnya tidak ada.
 *
 * Yang dipakai dari router hanya `useRouteError` dan `useNavigate` — keduanya
 * disediakan `RouterProvider`, yang masih hidup ketika halaman di dalamnya
 * jatuh. "Coba lagi" memuat ulang seluruh halaman, bukan sekadar merender
 * ulang: penyebab paling sering di aplikasi ini adalah chunk `lazy()` yang
 * basi setelah pembaruan, dan itu hanya sembuh dengan memuat ulang.
 *
 * Kalau yang rusak justru halaman tujuan tombol "kembali", navigasi klien ke
 * alamat yang sama hanya akan merender komponen yang sama dan jatuh lagi; di
 * keadaan itu tombolnya memuat ulang alamat tersebut secara penuh.
 *
 * Dipasang di dua tingkat router: di dalam `AppLayout` (navbar-nya masih ada,
 * dan tanpa judul kepala halamannya kosong) dan di puncak, di luar layout.
 * Karena itu slot navbar dibaca lewat `useContext` langsung, bukan
 * `useNavbarSlots` yang melempar di luar layout.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const home = resolveHomeAction()
  const insideLayout = useContext(NavbarContext) !== null

  useEffect(() => {
    console.error("[RouteErrorPage]", error)
  }, [error])

  return (
    <>
      {insideLayout ? <NavbarTitle>{describeRouteError(error).title}</NavbarTitle> : null}
      <ErrorScreen
        error={error}
        homeLabel={home.label}
        onHome={() =>
          pathname === home.path
            ? window.location.assign(home.path)
            : void navigate(home.path, { replace: true })
        }
        onRetry={() => window.location.reload()}
      />
    </>
  )
}
