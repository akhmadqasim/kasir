import { Landmark } from "lucide-react"

import { cn } from "@/lib/utils"
import { BANK_LOGOS } from "../../banks"

interface BankLogoProps {
  /**
   * Nama bank persis seperti di `BANKS` — dipakai untuk mencari logonya di
   * `BANK_LOGOS`. `undefined` untuk teks yang belum cocok dengan bank manapun
   * (input kosong, atau nama custom yang diketik kasir) — jatuh ke ikon
   * `Landmark` seperti bank yang memang belum punya logo.
   */
  name?: string
  className?: string
}

/**
 * Kotak logo bank berukuran tetap, dipakai di tiap baris `ListBox` bank
 * transfer dan di kolom input saat nama yang diketik cocok salah satu
 * `BANKS`. Bank yang belum punya logo (tidak ditemukan sumber resmi, atau
 * nama custom yang diketik kasir) jatuh ke ikon `Landmark` netral, di kotak
 * yang sama — supaya barisnya tetap sejajar.
 *
 * Bukan `Avatar` HeroUI: `Avatar` di aplikasi ini selalu bulat (DESIGN.md
 * §4.2), sedangkan wordmark bank rata-rata persegi panjang dan butuh latar
 * putih tetap supaya logo gelap tetap terbaca di tema gelap — kotak sendiri,
 * bukan variasi baru pada komponen yang harus tetap bulat di tempat lain.
 */
export function BankLogo({ name, className }: BankLogoProps) {
  const src = name ? BANK_LOGOS[name] : undefined

  return (
    <span
      // `bg-white` mentah, bukan token tema: logo bank datang sebagai file
      // yang menganggap latarnya kertas putih (banyak wordmark gelap
      // tanpa latar sendiri), sama seperti alasan `bg-white` di
      // `receipt-preview.tsx` untuk kertas termal.
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-border",
        className,
      )}
    >
      {src ? (
        <img
          alt=""
          className="size-full rounded-md object-contain p-0.5"
          loading="lazy"
          src={src}
        />
      ) : (
        <Landmark aria-hidden="true" className="size-3.5 text-muted" />
      )}
    </span>
  )
}
