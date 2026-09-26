import type { ReactNode } from "react"
import { Table } from "@heroui/react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import { SectionCard } from "./section-card"

/** Baris skeleton selama permintaan pertama — cukup untuk mengisi kartu tanpa melompat. */
const SKELETON_ROWS = 4

export interface DashboardTableProps {
  /** Judul kartu sekaligus `aria-label` tabelnya. */
  title: string
  /** Deretan `Table.Column`; tepat satu `isRowHeader`. */
  columns: ReactNode
  /** Jumlah kolom di `columns`, untuk membentuk baris skeleton. */
  columnCount: number
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  /** `true` selama permintaan ulang berjalan. */
  isRetrying?: boolean
  /** Keadaan kosong: ikon dan kalimatnya, khusus untuk tabel ini. */
  emptyIcon: ReactNode
  emptyTitle: string
  emptyDescription?: string
  /** Lebar minimum tabel yang kolomnya banyak. */
  contentClassName?: string
  children: ReactNode
}

/**
 * Kerangka keempat tabel dashboard: kartu berjudul, `Table` HeroUI, dan tiga
 * keadaan selain berisi — memuat (baris `Skeleton`), gagal (`NoData` merah
 * dengan tombol coba lagi), kosong (`NoData` berikon).
 *
 * Sebelumnya tabel yang masih memuat dan yang gagal sama-sama menulis "Belum
 * ada data", jadi stok menipis yang belum sampai tampak seperti stok aman.
 *
 * `tabular-nums` dipasang sekali di `Table.Content` dan diwariskan ke setiap sel.
 */
export function DashboardTable({
  title,
  columns,
  columnCount,
  isLoading,
  error,
  onRetry,
  isRetrying = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  contentClassName,
  children,
}: DashboardTableProps) {
  return (
    <SectionCard title={title}>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={title} className={cn("tabular-nums", contentClassName)}>
            <Table.Header>{columns}</Table.Header>
            <Table.Body
              renderEmptyState={() =>
                error ? (
                  <LoadError
                    isRetrying={isRetrying}
                    title={id.loadFailed.of(title.toLowerCase())}
                    onRetry={onRetry}
                  >
                    {error.message}
                  </LoadError>
                ) : (
                  <NoData icon={emptyIcon} title={emptyTitle}>
                    {emptyDescription}
                  </NoData>
                )
              }
            >
              {isLoading ? (
                <TableSkeletonRows columns={columnCount} rows={SKELETON_ROWS} />
              ) : (
                children
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </SectionCard>
  )
}
