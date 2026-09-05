import { toast as sonnerToast } from "sonner"

/**
 * Satu-satunya jalur notifikasi toast aplikasi.
 *
 * Semua layar memanggil `toast` dari sini, bukan langsung dari `sonner`, supaya
 * penggantian ke komponen `Toast` HeroUI cukup mengubah file ini. Permukaannya
 * sengaja sempit — hanya tiga tingkat pesan dengan satu argumen string, persis
 * yang dipakai codebase — sehingga tidak ada opsi `sonner` yang bocor ke pemanggil.
 *
 * Kalau nanti butuh deskripsi, aksi, atau toast yang bisa ditutup manual, tambahkan
 * di sini sebagai API sendiri, jangan meneruskan objek opsi `sonner`.
 */
export const toast = {
  /** Operasi berhasil. */
  success(message: string): void {
    sonnerToast.success(message)
  },
  /** Operasi gagal, atau input ditolak. */
  error(message: string): void {
    sonnerToast.error(message)
  },
  /** Operasi tetap berjalan, tapi kasir perlu memeriksa sesuatu. */
  warning(message: string): void {
    sonnerToast.warning(message)
  },
}
