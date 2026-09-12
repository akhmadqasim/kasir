import type { ReactNode } from "react"
import { Button, Card, Separator } from "@heroui/react"

import { NoData } from "@/components/no-data"
import type { SummaryItem } from "@/components/summary-list"
import { id } from "@/i18n/id"
import { FlowColumns } from "../flow-columns"
import { ConfirmCard } from "./confirm-card"

interface ServiceFlowLayoutProps {
  /** Halaman PPOB penuh: isian di kartu kiri, konfirmasi di kolom kanan yang menempel. */
  wideLayout: boolean
  /** Ringkasan yang siap ditambahkan; `null` sebelum ada yang bisa dikonfirmasi. */
  confirmItems: SummaryItem[] | null
  onConfirm: () => void
  /** Ikon kolom kanan yang masih kosong (layar lebar). */
  placeholderIcon: ReactNode
  /** Kalimat kolom kanan yang masih kosong (layar lebar). */
  placeholderText: string
  /** Isian layanannya; jarak antar barisnya diatur di sini. */
  children: ReactNode
}

/**
 * Kerangka satu layanan quick-access dalam dua wujud: di panel kasir isian dan
 * konfirmasi bertumpuk dipisah garis; di halaman PPOB isian masuk kartu kiri
 * dan konfirmasi menempel di kolom kanan.
 */
export function ServiceFlowLayout({
  wideLayout,
  confirmItems,
  onConfirm,
  placeholderIcon,
  placeholderText,
  children,
}: ServiceFlowLayoutProps) {
  // Kartunya sendiri sudah berarti "siap": tidak perlu lencana yang mengulanginya.
  const confirmCard = confirmItems ? (
    <ConfirmCard
      scrollIntoView
      footer={
        <Button fullWidth size="lg" onPress={onConfirm}>
          Tambah ke Keranjang
        </Button>
      }
      items={confirmItems}
      title={id.ppob.confirm}
    />
  ) : null

  if (wideLayout) {
    return (
      <FlowColumns
        aside={
          confirmCard ?? (
            <Card>
              <Card.Content>
                <NoData icon={placeholderIcon} title={placeholderText} />
              </Card.Content>
            </Card>
          )
        }
      >
        <Card>
          <Card.Content className="gap-4">{children}</Card.Content>
        </Card>
      </FlowColumns>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {children}
      {confirmCard ? (
        <>
          <Separator />
          {confirmCard}
        </>
      ) : null}
    </div>
  )
}
