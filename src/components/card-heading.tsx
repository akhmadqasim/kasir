import type { ReactNode } from "react"
import { Card } from "@heroui/react"

/**
 * `Card.Title` yang dirender sebagai heading dengan tingkat yang benar.
 *
 * `Card.Title` HeroUI selalu `<h3>`. Di bawah `<h1>` navbar, kartu pertama di
 * halaman jadi lompat dari h1 ke h3, dan axe menandainya (`heading-order`):
 * pembaca layar yang menavigasi per heading kehilangan satu tingkat. Kartu di
 * badan halaman adalah bagian tingkat kedua, jadi bawaannya `h2`; `level={1}`
 * untuk kartu yang berdiri sendiri tanpa navbar (login, layar galat di luar
 * layout). Rupanya tetap milik `Card.Title` — hanya elemennya yang berganti.
 */
export function CardHeading({
  level = 2,
  className,
  children,
}: {
  level?: 1 | 2 | 3
  className?: string
  children: ReactNode
}) {
  return (
    <Card.Title
      className={className}
      render={(props) =>
        level === 1 ? <h1 {...props} /> : level === 2 ? <h2 {...props} /> : <h3 {...props} />
      }
    >
      {children}
    </Card.Title>
  )
}
