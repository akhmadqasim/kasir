import { useEffect, useRef, type ReactNode } from "react"
import { Card, Separator } from "@heroui/react"

import { SummaryList, type SummaryItem } from "@/components/summary-list"

interface ConfirmCardProps {
  /** Isi `Card.Header`: lencana "siap" atau `Card.Title`. */
  title: ReactNode
  items: SummaryItem[]
  /** Baris biaya dan total, dipisah garis dari rincian di atasnya. */
  totals?: SummaryItem[]
  /** Isi `Card.Footer`: tombol aksinya. */
  footer: ReactNode
  /**
   * Gulir kartu ini ke layar saat muncul. Di kolom sempit ia berada di bawah
   * isian yang baru saja diisi, jadi tanpa ini kasir tidak melihat ada yang
   * berubah.
   */
  scrollIntoView?: boolean
}

/**
 * Kartu konfirmasi di ujung setiap flow PPOB: ringkasan yang akan ditagih dan
 * satu tombol untuk melanjutkannya. Bentuk yang sama dipakai oleh enam layanan
 * quick-access, transfer, dan PP.
 */
export function ConfirmCard({
  title,
  items,
  totals,
  footer,
  scrollIntoView = false,
}: ConfirmCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollIntoView) ref.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [scrollIntoView])

  return (
    <div ref={ref}>
      <Card>
        <Card.Header className="items-start">{title}</Card.Header>
        <Card.Content className="gap-3">
          <SummaryList items={items} />
          {totals ? (
            <>
              <Separator />
              <SummaryList items={totals} />
            </>
          ) : null}
        </Card.Content>
        <Card.Footer>{footer}</Card.Footer>
      </Card>
    </div>
  )
}
