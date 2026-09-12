import type { ReactNode } from "react"
import { Avatar, Card } from "@heroui/react"
import { Store } from "lucide-react"

/**
 * Kartu untuk layar yang berdiri sendiri sebelum pengguna masuk: login dan dua
 * langkah onboarding.
 *
 * Bentuknya menyalin `login-demo.tsx` resmi HeroUI, bukan dikarang: `Card`
 * dengan `p-5`, kepala bertumpuk di tengah — `Avatar` berisi ikon lalu
 * `Card.Title` — dan isi yang dibuka dengan satu kalimat muted `text-balance`
 * sebelum kontrolnya. `p-5` adalah satu-satunya tempat padding `Card` ditimpa
 * di aplikasi ini, dan alasannya demo HeroUI sendiri melakukannya untuk kartu
 * yang berdiri sendiri di tengah layar kosong.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="w-full max-w-sm p-5">
      <Card.Header className="items-center gap-2">
        <Avatar>
          <Avatar.Fallback>
            <Store className="size-4" />
          </Avatar.Fallback>
        </Avatar>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content className="gap-4">
        {description ? (
          <p className="text-center text-sm text-balance text-muted">{description}</p>
        ) : null}
        {children}
      </Card.Content>
    </Card>
  )
}

/** Latar layar auth: kanvas kosong, kartunya di tengah. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center overflow-y-auto bg-background p-6">
      {children}
    </div>
  )
}
