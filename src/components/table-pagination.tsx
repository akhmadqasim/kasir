import { Pagination } from "@heroui/react"

import { id } from "@/i18n/id"

interface TablePaginationProps {
  /** Halaman yang sedang ditampilkan, 1-based. */
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

/**
 * Navigasi halaman untuk tabel riwayat: transaksi, refund dan write-off.
 *
 * Ketiga layar sebelumnya menyalin blok yang sama — `justify-end`, teks
 * "Halaman X dari Y", dan dua tombol outline yang tahu kapan harus mati.
 * Bentuknya dipertahankan; yang berubah hanya fondasinya: HeroUI `Pagination`
 * membungkusnya dalam `<nav aria-label="pagination">` dan menjalankan tombolnya
 * lewat React Aria, jadi status nonaktifnya ikut terbaca screen reader.
 *
 * `justify-end` menimpa `justify-between` bawaan HeroUI supaya ringkasan tetap
 * menempel ke tombolnya, bukan terlempar ke ujung kiri tabel.
 */
export function TablePagination({ page, totalPages, onPageChange }: TablePaginationProps) {
  if (totalPages <= 1) return null

  return (
    <Pagination className="justify-end gap-2" size="sm">
      <Pagination.Summary>
        {id.transactions.page} {page} {id.transactions.of} {totalPages}
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={page <= 1}
            onPress={() => onPageChange(page - 1)}
          >
            <Pagination.PreviousIcon />
            <span>{id.transactions.prev}</span>
          </Pagination.Previous>
        </Pagination.Item>
        <Pagination.Item>
          <Pagination.Next
            isDisabled={page >= totalPages}
            onPress={() => onPageChange(page + 1)}
          >
            <span>{id.transactions.next}</span>
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  )
}
