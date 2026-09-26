import type { ReactNode } from "react"
import { Alert, Skeleton, Table } from "@heroui/react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"

/**
 * Bagian yang benar-benar sama di sebelas layar laporan — dan hanya itu.
 *
 * Yang di sini: kerangka halaman (baris filter + isi) dan rangka `Table` HeroUI
 * yang bersarang lima tingkat sebelum sampai ke baris pertama. Kartu ringkasan
 * memakai `StatCard` dari `src/components/` (DESIGN.md §4.2).
 *
 * Judul halaman tidak digambar di sini — DESIGN.md §5.1.
 *
 * Yang **tidak** di sini, dan sengaja tetap ditulis di tiap layar karena justru
 * di situlah laporannya berbeda:
 *  - definisi kolom dan isi sel — tiap laporan punya bentuknya sendiri;
 *  - kontrol filter — rentang tanggal, pencarian, tahun, Top-N, semuanya beda;
 *  - baris total di kaki tabel — hanya "Jenis Pembayaran" yang punya, dan itu
 *    baris biasa di dalam `Table.Body`, bukan `Table.Footer` (kaki HeroUI
 *    duduk di luar `<table>` dan tidak sejajar dengan kolom, jadi tempatnya
 *    pagination, bukan angka total).
 */

interface ReportPageProps {
  /** Isi baris filter. Dilewatkan kalau laporannya tidak punya filter. */
  filters?: ReactNode
  children: ReactNode
}

/** Kerangka satu layar laporan: baris filter, lalu isinya. Jarak dan padding: DESIGN.md §5.1, §3.5. */
export function ReportPage({ filters, children }: ReportPageProps) {
  return (
    <div className="flex h-full flex-col gap-4">
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      {children}
    </div>
  )
}

/**
 * Angka kartu ringkasan selagi laporan dimuat. Kartunya tetap digambar dengan
 * labelnya, supaya tabel di bawahnya tidak melompat turun saat datanya datang —
 * dulu kartu baru muncul setelah data ada, dan hilang lagi tiap filter diganti.
 */
export function StatSkeleton() {
  // Rendered as a `span`, so it stays valid whatever element `StatCard` wraps its
  // value in — the default `div` inside a `<p>` is invalid HTML (React logs it).
  return (
    <Skeleton<"span">
      className="block h-8 w-28 rounded-lg"
      render={(props) => <span {...props} />}
    />
  )
}

interface TruncationNoticeProps {
  /** Baris yang dikirim backend. */
  shown: number
  /** Baris yang cocok seluruhnya (`totalCount`). */
  total: number
  /** Benda yang dihitung: "struk", "produk". */
  noun: string
  /** Apa yang harus dilakukan kasir untuk melihat sisanya. */
  children: ReactNode
}

/**
 * Peringatan bahwa backend memotong daftarnya (`items.length < totalCount`).
 * Tidak menggambar apa pun selama daftarnya utuh.
 */
export function TruncationNotice({ shown, total, noun, children }: TruncationNoticeProps) {
  if (shown >= total) return null

  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {id.reports.truncated(formatNumber(shown), formatNumber(total), noun)}
        </Alert.Title>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  )
}

/** Banyak baris skeleton saat data pertama dimuat, sama seperti layar riwayat. */
const SKELETON_ROWS = 5

interface ReportTableProps {
  /** `aria-label` tabel — biasanya sama dengan judul laporannya. */
  label: string
  /**
   * Jumlah kolom di `columns`. React Aria melempar kalau jumlah sel sebuah baris
   * tidak sama dengan jumlah kolom, jadi angka ini harus ikut berubah setiap kali
   * ada kolom ditambah atau dibuang; ia hanya dipakai untuk membentuk baris skeleton.
   */
  columnCount: number
  /** Deretan `Table.Column`. Tepat satu di antaranya harus `isRowHeader`. */
  columns: ReactNode
  isLoading: boolean
  /**
   * Kegagalan query. Tanpa ini laporan yang errornya di backend tampil sama persis
   * dengan laporan yang memang kosong, dan kasir tidak punya cara membedakannya.
   */
  error?: Error | null
  /**
   * Ulangi query yang gagal. Tanpa ini keadaan gagal hanya bisa dipulihkan
   * dengan pindah halaman lalu kembali, karena laporan tidak dimuat ulang sendiri.
   */
  onRetry?: () => void
  /** `true` selama permintaan ulang berjalan: tombol "Coba lagi" tidak bisa ditekan dua kali. */
  isRetrying?: boolean
  /** Kalimat keadaan kosong. Tanpa ini dipakai bawaan `NoData` ("Belum ada data"). */
  emptyMessage?: string
  /** Kelas tambahan untuk `Table.Content`, dipakai tabel lebar untuk menahan lebar minimum. */
  contentClassName?: string
  /** Baris data. Baris total, kalau ada, ditaruh paling akhir oleh pemanggil. */
  children: ReactNode
}

/**
 * `tabular-nums` dipasang sekali di `Table.Content` dan diwariskan ke setiap sel:
 * kolom nominal yang rata kanan tidak lagi bergoyang saat datanya berubah, dan
 * sebelas laporan tidak perlu mengulang kelas itu di tiap `Table.Cell`.
 *
 * Judul kolom tidak pernah dilipat: "Qty Terjual" dan "Metode Bayar" yang pecah
 * dua baris di layar 1024px membuat kepala tabel lebih tinggi dari barisnya.
 * Tabel yang memang lebih lebar dari layar menggulir di `Table.ScrollContainer`.
 */
export function ReportTable({
  label,
  columnCount,
  columns,
  isLoading,
  error,
  onRetry,
  isRetrying = false,
  emptyMessage,
  contentClassName,
  children,
}: ReportTableProps) {
  const renderEmptyState = () =>
    error ? (
      <LoadError isRetrying={isRetrying} title={id.loadFailed.report} onRetry={onRetry}>
        {error.message}
      </LoadError>
    ) : (
      <NoData title={emptyMessage} />
    )

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content
            aria-label={label}
            className={cn("tabular-nums [&_th]:whitespace-nowrap", contentClassName)}
          >
            <Table.Header>{columns}</Table.Header>
            <Table.Body renderEmptyState={renderEmptyState}>
              {isLoading ? (
                <TableSkeletonRows columns={columnCount} rows={SKELETON_ROWS} />
              ) : (
                children
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}
