import type { ReactNode } from "react"
import { Skeleton } from "@heroui/react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { id } from "@/i18n/id"

export interface ChartPlaceholderProps {
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  /** `true` selama permintaan ulang berjalan. */
  isRetrying?: boolean
  emptyIcon: ReactNode
  emptyTitle: string
  emptyDescription?: string
}

/**
 * Pengganti grafik saat belum ada yang bisa digambar: memuat, gagal, atau
 * kosong. Ketiganya setinggi grafiknya (240px), supaya kartu tidak melompat
 * saat datanya datang (DESIGN.md §5.5).
 *
 * Dulu ketiganya satu kalimat "Belum ada data" — grafik yang masih memuat dan
 * grafik yang gagal dimuat tampak sama dengan toko yang memang belum berjualan.
 */
export function ChartPlaceholder({
  isLoading,
  error,
  onRetry,
  isRetrying = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
}: ChartPlaceholderProps) {
  if (isLoading) {
    return <Skeleton className="h-[240px] w-full rounded-xl" />
  }

  return (
    <div className="flex h-[240px] items-center justify-center">
      {error ? (
        <LoadError isRetrying={isRetrying} title={id.loadFailed.chart} onRetry={onRetry}>
          {error.message}
        </LoadError>
      ) : (
        <NoData icon={emptyIcon} title={emptyTitle}>
          {emptyDescription}
        </NoData>
      )}
    </div>
  )
}
