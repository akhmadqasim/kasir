import { useEffect } from "react"
import { useLocation, useNavigate, useRouteError } from "react-router-dom"

import { ErrorScreen } from "./error-screen"
import { resolveHomeAction } from "./route-error"

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
 */
export function RouteErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const home = resolveHomeAction()

  useEffect(() => {
    console.error("[RouteErrorPage]", error)
  }, [error])

  return (
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
  )
}
