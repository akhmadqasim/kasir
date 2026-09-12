import type { ReactNode } from "react"
import { Card } from "@heroui/react"

/**
 * Pembungkus setiap daftar di dashboard: judul, lalu isinya.
 *
 * Sengaja setipis ini. Tugasnya cuma satu — membuat keempat tabel dashboard
 * berdiri dalam kartu yang sama persis — dan `Card` HeroUI sudah menangani
 * jarak, padding, dan bayangannya.
 */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  )
}
