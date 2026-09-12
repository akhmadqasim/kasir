import type { ReactNode } from "react"
import { Button, Card, Chip, Separator } from "@heroui/react"
import { CheckCircle2, Smartphone } from "lucide-react"

import { NoData } from "@/components/no-data"
import type { SummaryItem } from "@/components/summary-list"
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
  const confirmCard = confirmItems ? (
    <ConfirmCard
      scrollIntoView
      footer={
        <Button fullWidth size="lg" onPress={onConfirm}>
          <Smartphone />
          Tambah ke Keranjang
        </Button>
      }
      items={confirmItems}
      title={
        <Chip color="success" variant="soft">
          <CheckCircle2 />
          <Chip.Label>Siap ditambahkan ke keranjang</Chip.Label>
        </Chip>
      }
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
