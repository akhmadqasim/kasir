import type { ReactNode } from "react"
import { Skeleton, Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { cn } from "@/lib/utils"

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
 */
export function ReportTable({
  label,
  columnCount,
  columns,
  isLoading,
  error,
  emptyMessage = "Tidak ada data",
  contentClassName,
  children,
}: ReportTableProps) {
  const renderEmptyState = () =>
    error ? (
      <NoData title={`Error: ${error.message}`} tone="danger" />
    ) : (
      <NoData title={emptyMessage} />
    )

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={label} className={cn("tabular-nums", contentClassName)}>
            <Table.Header>{columns}</Table.Header>
            <Table.Body renderEmptyState={renderEmptyState}>
              {isLoading
                ? Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                    <Table.Row key={`skeleton-${rowIndex}`} id={`skeleton-${rowIndex}`}>
                      {Array.from({ length: columnCount }).map((_, cellIndex) => (
                        <Table.Cell key={cellIndex}>
                          <Skeleton className="h-5 w-full" />
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))
                : children}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}
