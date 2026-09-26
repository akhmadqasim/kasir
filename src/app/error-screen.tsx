import { Button, Card } from "@heroui/react"
import { Lock, RefreshCw, SearchX, TriangleAlert } from "lucide-react"

import { CardHeading } from "@/components/card-heading"
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
  /**
   * Tingkat heading judul kartu. `2` di dalam layout, di bawah `<h1>` navbar
   * yang sudah menyebut judul yang sama; `1` (bawaan) saat layar ini berdiri
   * sendiri tanpa navbar dan judul kartunya satu-satunya judul halaman.
   */
  headingLevel?: 1 | 2
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
export function ErrorScreen({
  error,
  homeLabel,
  onHome,
  onRetry,
  headingLevel = 1,
}: ErrorScreenProps) {
  const { kind, title, description, details } = describeRouteError(error)
  const Icon = ICONS[kind]
  const isCrash = kind === "crash"

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        {/* `role="alert"`: layar ini menggantikan halaman tanpa aba-aba, jadi
            pembaca layar mengumumkan judul dan kalimatnya begitu muncul. */}
        <Card.Header className="items-center gap-2 text-center" role="alert">
          <span
            aria-hidden="true"
            className={cn(
              "mb-1 flex size-12 items-center justify-center rounded-full",
              isCrash ? "bg-danger-soft text-danger-soft-foreground" : "bg-default text-foreground",
            )}
          >
            <Icon className="size-6" />
          </span>
          <CardHeading level={headingLevel}>{title}</CardHeading>
          <Card.Description className="text-balance">{description}</Card.Description>
        </Card.Header>
        {details ? (
          <Card.Content>
            <InfoPanel>
              {/* Jejak tumpukan bisa lebih tinggi dari kotaknya; `tabIndex`
                  membuatnya bisa digulung dengan papan ketik (axe
                  `scrollable-region-focusable`), dan cincinnya menandai
                  kotak yang sedang digulung. */}
              <pre
                aria-label="Detail teknis"
                className="max-h-48 overflow-auto rounded-md text-start text-xs break-words whitespace-pre-wrap text-muted outline-none select-text focus-visible:ring-2 focus-visible:ring-focus"
                tabIndex={0}
              >
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
                {t.common.retry}
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
