import type { ReactNode } from "react"

import { id as t } from "@/i18n/id"
import { cn } from "@/lib/utils"

export interface NoDataProps {
  /** Ikon lucide di atas judul, tanpa `className` — ukurannya (32px) diatur di sini. */
  icon?: ReactNode
  /** Kalimat pendek. Tanpa ini dipakai `t.dashboard.noData` ("Belum ada data"). */
  title?: string
  /** Keterangan di bawah judul, bila kalimat pertamanya belum cukup. */
  children?: ReactNode
  /** `danger` untuk keadaan gagal: pesan `ApiError` yang menggantikan isi. */
  tone?: "default" | "danger"
}

/**
 * Keadaan kosong, satu bentuk untuk semua tempat: sel tabel dashboard, kolom
 * ringkasan PPOB sebelum ada yang dipilih, hasil pencarian tanpa hasil.
 *
 * Menggabungkan `NoData` dashboard (satu `<p>` muted rata tengah) dan
 * `FlowPlaceholder` PPOB (ikon lalu kalimat). Tanpa `icon`, `title`, dan
 * `children`, keluarannya persis `<p>` yang lama — test tabel dashboard
 * mencari teks itu, dan tidak ada alasan menambah pembungkus untuk satu
 * kalimat.
 *
 * Bukan `Card`: pemakainya sudah menaruhnya di dalam kartu atau sel, dan kartu
 * di dalam kartu adalah bingkai ganda. Bukan kotak bergaris putus-putus: garis
 * putus-putus menyiratkan area yang bisa dijatuhi berkas.
 */
export function NoData({ icon, title, children, tone = "default" }: NoDataProps) {
  const text = title ?? t.dashboard.noData
  const color = tone === "danger" ? "text-danger" : "text-muted"

  if (!icon && !children) {
    return <p className={cn("py-8 text-center text-sm", color)}>{text}</p>
  }

  return (
    <div className={cn("flex flex-col items-center gap-2 py-8 text-center text-sm", color)}>
      {icon ? (
        <span aria-hidden="true" className="[&>svg]:size-8">
          {icon}
        </span>
      ) : null}
      <p>{text}</p>
      {children ? <p className="text-muted">{children}</p> : null}
    </div>
  )
}
