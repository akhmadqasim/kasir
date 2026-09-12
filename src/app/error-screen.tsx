import { Button, Card, Disclosure } from "@heroui/react"
import { Lock, RefreshCw, SearchX, TriangleAlert } from "lucide-react"

import { InfoPanel } from "@/components/info-panel"
import { id as t } from "@/i18n/id"
import { cn } from "@/lib/utils"
import { describeRouteError, type RouteErrorKind } from "./route-error"

export interface ErrorScreenProps {
  /** Apa pun yang dilempar: `Response` router, `Error`, atau nilai lain. */
  error: unknown
  /** Label dan aksi tombol utama yang membawa pengguna kembali bekerja. */
  homeLabel: string
  onHome: () => void
  /** Hanya ditampilkan untuk kesalahan aplikasi; alamat yang salah tidak perlu dicoba lagi. */
  onRetry: () => void
}

const ICONS: Record<RouteErrorKind, typeof TriangleAlert> = {
  "not-found": SearchX,
  forbidden: Lock,
  crash: TriangleAlert,
}

/**
 * Satu rupa untuk semua layar gagal, di mana pun ia tertangkap: pengganti
 * layar bawaan react-router saat sebuah rute melempar, dan isi `ErrorBoundary`
 * kelas yang menjaga seluruh pohon di luar router.
 *
 * Kasir sedang berdiri di depan antrean, jadi kartunya berkata apa yang terjadi
 * dalam satu kalimat dan menawarkan satu tombol utama untuk kembali bekerja.
 * Jejak kesalahannya ada, tapi terlipat di "Detail teknis" — itu untuk admin
 * yang nanti diminta menelusuri, bukan untuk dibaca di meja kasir.
 *
 * Tidak memakai hook router maupun store: kalau yang rusak justru provider di
 * atasnya, layar ini tetap harus bisa digambar.
 */
export function ErrorScreen({ error, homeLabel, onHome, onRetry }: ErrorScreenProps) {
  const { kind, title, description, details } = describeRouteError(error)
  const Icon = ICONS[kind]
  const isCrash = kind === "crash"

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <Card.Header className="items-center gap-2 text-center">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-10 items-center justify-center rounded-full",
              isCrash ? "bg-danger-soft text-danger-soft-foreground" : "bg-default text-foreground",
            )}
          >
            <Icon className="size-5" />
          </span>
          <Card.Title>{title}</Card.Title>
          <Card.Description className="text-balance">{description}</Card.Description>
        </Card.Header>
        {details ? (
          <Card.Content className="items-center">
            <Disclosure>
              <Disclosure.Heading>
                <Button size="sm" slot="trigger" variant="tertiary">
                  {t.errorPage.technicalDetails}
                  <Disclosure.Indicator />
                </Button>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body>
                  <InfoPanel>
                    <pre className="max-h-64 overflow-auto text-start text-xs break-words whitespace-pre-wrap text-muted select-text">
                      {details}
                    </pre>
                  </InfoPanel>
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          </Card.Content>
        ) : null}
        <Card.Footer className="flex-col justify-center gap-2 sm:flex-row">
          {isCrash ? (
            <Button variant="secondary" onPress={onRetry}>
              <RefreshCw />
              {t.errorPage.retry}
            </Button>
          ) : null}
          <Button onPress={onHome}>{homeLabel}</Button>
        </Card.Footer>
      </Card>
    </div>
  )
}
