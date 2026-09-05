import { toast as heroToast } from "@heroui/react"

/**
 * Satu-satunya jalur notifikasi toast aplikasi.
 *
 * Semua layar memanggil `toast` dari sini, bukan langsung dari `@heroui/react`,
 * supaya penggantian implementasi cukup mengubah file ini. Permukaannya sengaja
 * sempit — hanya tiga tingkat pesan dengan satu argumen string, persis yang
 * dipakai codebase — sehingga tidak ada opsi HeroUI yang bocor ke pemanggil.
 *
 * Kalau nanti butuh deskripsi, aksi, atau toast yang bisa ditutup manual, tambahkan
 * di sini sebagai API sendiri, jangan meneruskan objek opsi HeroUI.
 *
 * Provider-nya dipasang sekali di `src/App.tsx` (`<Toast.Provider />`); tanpa itu
 * antrean toast tidak punya tempat untuk dirender.
 */
export const toast = {
  /** Operasi berhasil. */
  success(message: string): void {
    heroToast.success(message)
  },
  /** Operasi gagal, atau input ditolak. HeroUI menamai varian ini `danger`. */
  error(message: string): void {
    heroToast.danger(message)
  },
  /** Operasi tetap berjalan, tapi kasir perlu memeriksa sesuatu. */
  warning(message: string): void {
    heroToast.warning(message)
  },
}
