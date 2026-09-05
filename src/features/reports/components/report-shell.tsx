import type { ReactNode } from "react"
import { Card, Skeleton, Table } from "@heroui/react"

/**
 * Bagian yang benar-benar sama di sebelas layar laporan — dan hanya itu.
 *
 * Yang di sini: kerangka halaman (judul + baris filter), kartu ringkasan
 * label/nilai yang tersalin 25 kali, dan rangka `Table` HeroUI yang bersarang
 * lima tingkat sebelum sampai ke baris pertama.
 *
 * Yang **tidak** di sini, dan sengaja tetap ditulis di tiap layar karena justru
 * di situlah laporannya berbeda:
 *  - definisi kolom dan isi sel — tiap laporan punya bentuknya sendiri;
 *  - kontrol filter — rentang tanggal, pencarian, tahun, Top-N, semuanya beda;
 *  - baris total di kaki tabel — hanya "Jenis Pembayaran" yang punya, dan itu
 *    baris biasa di dalam `Table.Body`, bukan `Table.Footer` (kaki HeroUI
 *    duduk di luar `<table>` dan tidak sejajar dengan kolom, jadi tempatnya
 *    pagination, bukan angka total);
 *  - blok ringkasan yang bukan kartu label/nilai — grid per-alasan di laporan
 *    kerugian dan kartu berbilah persentase di jenis pembayaran.
 */

interface ReportPageProps {
  title: string
  /** Isi baris filter. Dilewatkan kalau laporannya tidak punya filter. */
  filters?: ReactNode
  children: ReactNode
}

export function ReportPage({ title, filters, children }: ReportPageProps) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      {filters && <div className="flex flex-wrap items-center gap-3">{filters}</div>}
      {children}
    </div>
  )
}

/** Nada angka ringkasan: laba hijau, kerugian merah, sisanya netral. */
export type ReportStatTone = "default" | "success" | "danger"

const STAT_TONE_CLASS: Record<ReportStatTone, string> = {
  default: "",
  success: "text-success",
  danger: "text-danger",
}

interface ReportStatCardProps {
  label: string
  value: ReactNode
  tone?: ReportStatTone
}

/**
 * Satu angka ringkasan di atas tabel.
 *
 * Labelnya memakai `Card.Description`, bukan `Card.Title`: `Card.Title` HeroUI
 * merender `h3`, dan lima kartu di bawah satu `h1` akan melompati tingkat
 * heading tanpa alasan — label metrik bukan judul bagian.
 */
export function ReportStatCard({ label, value, tone = "default" }: ReportStatCardProps) {
  return (
    <Card>
      <Card.Header className="pb-2">
        <Card.Description className="text-sm font-medium text-muted">
          {label}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <p className={`text-2xl font-bold ${STAT_TONE_CLASS[tone]}`.trimEnd()}>{value}</p>
      </Card.Content>
    </Card>
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
  const renderEmptyState = () => {
    if (error) {
      return <p className="py-10 text-center text-danger">Error: {error.message}</p>
    }
    return <p className="py-10 text-center text-muted">{emptyMessage}</p>
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={label} className={contentClassName}>
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
