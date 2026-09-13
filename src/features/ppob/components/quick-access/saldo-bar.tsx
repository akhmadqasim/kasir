import { useNavigate } from "react-router-dom"
import { Button, Skeleton, Surface } from "@heroui/react"
import { History, RefreshCw, Wallet } from "lucide-react"

import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { usePpobSaldo } from "../../hooks"

/**
 * Saldo Mitra satu baris di atas kisi layanan panel kasir, dengan muat-ulang dan
 * jalan ke riwayat — yang kini duduk di beranda PPOB, di sebelah menu layanan.
 */
export function SaldoBar() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = usePpobSaldo()

  return (
    <Surface className="flex items-center justify-between gap-2 px-3 py-2" variant="secondary">
      <div className="flex items-center gap-2">
        <Wallet aria-hidden="true" className="size-4 text-muted" />
        {isLoading ? (
          <Skeleton className="h-5 w-28" />
        ) : error ? (
          <span className="text-sm text-muted">Saldo tidak tersedia</span>
        ) : (
          <span className="text-sm font-semibold tabular-nums">
            {formatRupiah(data?.saldo ?? 0)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          aria-label={id.common.reload}
          isIconOnly
          size="sm"
          variant="tertiary"
          onPress={() => refetch()}
        >
          <RefreshCw />
        </Button>
        <Button
          aria-label="Riwayat transaksi"
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
