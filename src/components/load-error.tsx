import type { ReactNode } from "react"
import { RefreshCwIcon } from "lucide-react"

import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"

export interface LoadErrorProps {
  /** `loadFailed.*` — "Gagal memuat …", menyebut apa yang tidak datang. */
  title: string
  /** Alasannya, biasanya `error.message` dari `ApiError`. */
  children?: ReactNode
  /** Ulangi permintaan yang gagal. Tanpa ini tidak ada tombol "Coba lagi". */
  onRetry?: () => void
  /** `true` selama permintaan ulang berjalan: spinner di tombol, tidak bisa ditekan dua kali. */
  isRetrying?: boolean
  /** Ikon di atas judul; bawaannya segitiga peringatan `NoData`. */
  icon?: ReactNode
  /** Aksi lain di kiri "Coba lagi" — "Kembali" di sub-halaman yang gagal dimuat. */
  secondaryAction?: ReactNode
}

/**
 * Keadaan "gagal dimuat": `NoData tone="danger"` dengan pesan kesalahannya dan
 * satu tombol "Coba lagi", ditulis sekali.
 *
 * Sebelumnya sekitar tiga puluh layar merakitnya sendiri, dan hasilnya sedikit
 * berbeda di tiap tempat: sebagian dengan ikon muat ulang, sebagian tanpa;
 * sebagian menampilkan spinner saat mencoba lagi, sebagian membiarkan tombolnya
 * bisa ditekan berulang kali. Tombolnya `sm secondary` karena halaman di
 * sekitarnya sudah punya aksi utamanya sendiri (DESIGN.md §6: `common.retry`).
 */
export function LoadError({
  title,
  children,
  onRetry,
  isRetrying = false,
  icon,
  secondaryAction,
}: LoadErrorProps) {
  const retry = onRetry ? (
    <PendingButton isPending={isRetrying} size="sm" variant="secondary" onPress={onRetry}>
      {/* Spinner `PendingButton` menggantikan ikonnya, bukan berdiri di sebelahnya. */}
      {isRetrying ? null : <RefreshCwIcon />}
      {id.common.retry}
    </PendingButton>
  ) : null

  return (
    <NoData
      action={
        secondaryAction || retry ? (
          <>
            {secondaryAction}
            {retry}
          </>
        ) : undefined
      }
      icon={icon}
      title={title}
      tone="danger"
    >
      {children}
    </NoData>
  )
}
