import type { ReactNode } from "react"
import { Card } from "@heroui/react"

/**
 * `Card.Title` drawn as an `h2`. HeroUI renders an `h3`, which skips a level
 * right under the page title (the navbar's `h1`, or the report's own) — the
 * heading outline a screen reader walks would jump from 1 to 3.
 */
export function CardHeading({ children }: { children: ReactNode }) {
  return <Card.Title render={(props) => <h2 {...props} />}>{children}</Card.Title>
}
