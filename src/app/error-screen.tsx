import { Button, Card } from "@heroui/react"
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
 * Detail kesalahannya langsung terlihat di bawahnya — bukan terlipat di balik
 * tombol — supaya admin yang dipanggil ke meja kasir bisa memotretnya tanpa
 * mengklik apa-apa. Isinya `formatDetails` di `route-error.ts` yang memutuskan:
 * jejak tumpukan penuh hanya di build dev, di produksi cukup pesannya.
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
      <Card className="w-full max-w-xl">
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
          <Card.Content>
            <InfoPanel>
              <pre className="max-h-48 overflow-auto text-start text-xs break-words whitespace-pre-wrap text-muted select-text">
                {details}
              </pre>
            </InfoPanel>
          </Card.Content>
        ) : null}
        <Card.Footer className="flex-col justify-center gap-2 sm:flex-row">
          {/* Kalimat penjelasnya menyuruh "coba lagi dulu", jadi itu tombol
              utamanya saat aplikasi yang salah; untuk alamat salah/akses
              ditolak satu-satunya jalan adalah kembali. */}
          {isCrash ? (
            <>
              <Button variant="secondary" onPress={onHome}>
                {homeLabel}
              </Button>
              <Button onPress={onRetry}>
                <RefreshCw />
                {t.errorPage.retry}
              </Button>
            </>
          ) : (
            <Button onPress={onHome}>{homeLabel}</Button>
          )}
        </Card.Footer>
      </Card>
    </div>
  )
}
