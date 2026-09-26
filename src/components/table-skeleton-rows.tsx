import { Skeleton, Table } from "@heroui/react"

interface TableSkeletonRowsProps {
  /** Berapa baris — cukup untuk mengisi tempatnya tanpa melompat saat data datang. */
  rows: number
  /** Jumlah `Table.Column` di tabelnya; setiap baris harus punya sel sebanyak itu. */
  columns: number
}

/**
 * Baris-baris `Skeleton` selama permintaan pertama sebuah tabel (DESIGN.md
 * §5.4): satu `Skeleton className="h-5 w-full"` per sel, bukan `NoData
 * title="Memuat..."` dan bukan tabel yang hilang lalu muncul.
 *
 * Dipasang langsung sebagai isi `Table.Body`. Koleksi React Aria dibangun dengan
 * merender anak-anaknya, jadi komponen pembungkus yang menghasilkan `Table.Row`
 * dikenali sama seperti baris yang ditulis langsung.
 */
export function TableSkeletonRows({ rows, columns }: TableSkeletonRowsProps) {
  return Array.from({ length: rows }, (_, rowIndex) => (
    <Table.Row key={`skeleton-${rowIndex}`} id={`skeleton-${rowIndex}`}>
      {Array.from({ length: columns }, (_, cellIndex) => (
        <Table.Cell key={cellIndex}>
          <Skeleton className="h-5 w-full" />
        </Table.Cell>
      ))}
    </Table.Row>
  ))
}
