import type { ReactNode } from "react"
import { EmptyState } from "@heroui/react"

import { id as t } from "@/i18n/id"
import { cn } from "@/lib/utils"

export interface NoDataProps {
  /** Ikon lucide di atas judul, tanpa `className` — ukurannya (24px) diatur di sini. */
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
 * Dibangun di atas `EmptyState` HeroUI — komponen yang dipakai dokumentasi
 * `Table`, `ComboBox`, dan `Autocomplete` untuk `renderEmptyState`. Ia sudah
 * `text-sm text-muted`; yang ditambahkan di sini hanya susunan tengah dan
 * tinggi baris kosong yang sama di semua tabel, mengikuti contoh "Empty State"
 * di dokumentasi Table (ikon `size-6` lalu satu kalimat).
 *
 * Bukan `Card`: pemakainya sudah menaruhnya di dalam kartu atau sel, dan kartu
 * di dalam kartu adalah bingkai ganda. Bukan kotak bergaris putus-putus: garis
 * putus-putus menyiratkan area yang bisa dijatuhi berkas.
 */
export function NoData({ icon, title, children, tone = "default" }: NoDataProps) {
  const text = title ?? t.dashboard.noData

  return (
    <EmptyState
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 text-center",
        tone === "danger" && "text-danger",
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="[&>svg]:size-6">
          {icon}
        </span>
      ) : null}
      <p>{text}</p>
      {children ? <p className="text-muted">{children}</p> : null}
    </EmptyState>
  )
}
