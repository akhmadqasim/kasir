import { useNavigate } from "react-router-dom"
import { Button, Skeleton, Spinner, Surface, Tooltip } from "@heroui/react"
import { History, Info, RefreshCw, Wallet } from "lucide-react"

import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { usePpobSaldo } from "../../hooks"

/**
 * Saldo Mitra satu baris di atas kisi layanan panel kasir, dengan muat-ulang dan
 * jalan ke riwayat — yang kini duduk di beranda PPOB, di sebelah menu layanan.
 */
export function SaldoBar() {
  const navigate = useNavigate()
  const { data, isLoading, isFetching, error, refetch } = usePpobSaldo()

  return (
    <Surface className="flex items-center justify-between gap-2 px-3 py-2" variant="secondary">
      <div className="flex items-center gap-2">
        <Wallet aria-hidden="true" className="size-4 text-muted" />
        {isLoading ? (
          <Skeleton className="h-5 w-28" />
        ) : error ? (
          <>
            <span className="text-sm text-muted">{id.ppob.quickAccess.saldoUnavailable}</span>
            {/* Alasannya di tooltip tombol ikon, bukan atribut `title`: tombol
                bisa difokus dengan Tab, dan tooltip HeroUI muncul saat fokus
                serta dibacakan pembaca layar lewat `aria-describedby`. */}
            <Tooltip delay={300}>
              <Button
                aria-label={id.ppob.quickAccess.saldoUnavailableReason}
                isIconOnly
                size="sm"
                variant="tertiary"
              >
                <Info />
              </Button>
              <Tooltip.Content>{error.message}</Tooltip.Content>
            </Tooltip>
          </>
        ) : (
          <span className="text-sm font-semibold tabular-nums">
            {formatRupiah(data?.saldo ?? 0)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          aria-label={id.reloadLabel.saldo}
          isIconOnly
          isPending={isFetching}
          size="sm"
          variant="tertiary"
          onPress={() => refetch()}
        >
          {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />)}
        </Button>
        <Button
          aria-label={id.ppob.quickAccess.historyLabel}
          isIconOnly
          size="sm"
          variant="tertiary"
          onPress={() => navigate("/ppob")}
        >
          <History />
        </Button>
      </div>
    </Surface>
  )
}
