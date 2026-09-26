import type { ReactNode } from "react"
import { EmptyState } from "@heroui/react"
import { TriangleAlertIcon } from "lucide-react"

import { id as t } from "@/i18n/id"
import { cn } from "@/lib/utils"

export interface NoDataProps {
  /**
   * Ikon lucide di atas judul, tanpa `className` — ukurannya (20px, di dalam
   * lingkaran 40px) diatur di sini. `tone="danger"` tanpa ikon memakai
   * segitiga peringatan.
   */
  icon?: ReactNode
  /** Kalimat pendek. Tanpa ini dipakai `t.dashboard.noData` ("Belum ada data"). */
  title?: string
  /** Keterangan di bawah judul, bila kalimat pertamanya belum cukup. */
  children?: ReactNode
  /** `danger` untuk keadaan gagal: pesan `ApiError` yang menggantikan isi. */
  tone?: "default" | "danger"
  /**
   * Satu tombol di bawah kalimatnya — "Coba lagi" pada keadaan gagal, "Tambah
   * produk" pada daftar yang masih kosong. `size="sm"`, `variant="secondary"`
   * (atau `tertiary`): halaman di sekitarnya sudah punya aksi utamanya sendiri.
   */
  action?: ReactNode
}

/**
 * Keadaan kosong dan gagal, satu bentuk untuk semua tempat: sel tabel
 * dashboard, kolom ringkasan PPOB sebelum ada yang dipilih, hasil pencarian
 * tanpa hasil, daftar yang gagal dimuat.
 *
 * Dibangun di atas `EmptyState` HeroUI — komponen yang dipakai dokumentasi
 * `Table`, `ComboBox`, dan `Autocomplete` untuk `renderEmptyState`. Ia sudah
 * `text-sm text-muted`; yang ditambahkan di sini hanya susunan tengah, tinggi
 * baris kosong yang sama di semua tabel, dan ikon di dalam lingkaran lembut
 * seperti `Modal.Icon` — `bg-default` untuk kosong, `bg-danger-soft` untuk
 * gagal — supaya keadaan kosong terbaca sebagai keadaan, bukan sisa tata letak.
 *
 * Judulnya naik ke `text-foreground font-medium` begitu ada keterangan di
 * bawahnya: dua kalimat abu-abu yang sama beratnya tidak punya urutan baca.
 * Keadaan gagal diberi `role="alert"`, jadi pembaca layar mengumumkannya tanpa
 * harus menemukannya dulu, dan warnanya tidak berdiri sendiri — ada ikon
 * peringatan dan kalimatnya.
 *
 * Bukan `Card`: pemakainya sudah menaruhnya di dalam kartu atau sel, dan kartu
 * di dalam kartu adalah bingkai ganda. Bukan kotak bergaris putus-putus: garis
 * putus-putus menyiratkan area yang bisa dijatuhi berkas.
 */
export function NoData({ icon, title, children, tone = "default", action }: NoDataProps) {
  const text = title ?? t.dashboard.noData
  const isDanger = tone === "danger"
  const glyph = icon ?? (isDanger ? <TriangleAlertIcon /> : null)

  return (
    <EmptyState
      className="flex flex-col items-center justify-center gap-2 py-8 text-center"
      role={isDanger ? "alert" : undefined}
    >
      {glyph ? (
        <span
          aria-hidden="true"
          className={cn(
            "mb-1 flex size-10 items-center justify-center rounded-full [&>svg]:size-5",
            isDanger ? "bg-danger-soft text-danger-soft-foreground" : "bg-default text-muted",
          )}
        >
          {glyph}
        </span>
      ) : null}
      <p
        className={cn(
          "text-balance",
          isDanger ? "font-medium text-danger" : children && "font-medium text-foreground",
        )}
      >
        {text}
      </p>
      {children ? <div className="max-w-sm text-balance text-muted">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </EmptyState>
  )
}
