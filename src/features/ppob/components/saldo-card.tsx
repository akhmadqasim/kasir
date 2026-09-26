import { Button, Skeleton, Spinner } from "@heroui/react"
import { RefreshCw } from "lucide-react"

import { StatCard } from "@/components/stat-card"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { usePpobSaldo } from "../hooks"

/**
 * Saldo Mitra di kepala halaman PPOB: `StatCard` dengan tombol muat-ulang di kanan.
 *
 * Keadaan gagal menampilkan pesan dari server apa adanya. Penyebabnya bisa
 * macam-macam — Mitra belum diatur, sesi Mitra habis, server vendor sedang
 * gangguan — dan pesan server sudah menyebut yang mana; satu kalimat tetap
 * "belum dikonfigurasi" untuk semuanya menyuruh admin memeriksa pengaturan
 * yang sebenarnya sudah benar.
 */
export function SaldoCard() {
  const { data, isLoading, isFetching, error, refetch } = usePpobSaldo()

  // Render-prop `isPending`, idiom tombol muat-ulang di navbar (DESIGN.md §5.1).
  const action = (
    <Button
      isIconOnly
      aria-label={id.reloadLabel.saldo}
      isPending={isFetching}
      size="sm"
      variant="tertiary"
      onPress={() => refetch()}
    >
      {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />)}
    </Button>
  )

  if (isLoading) {
    return (
      <StatCard action={action} label={id.ppob.saldo} value={<Skeleton className="h-8 w-32" />} />
    )
  }

  if (error) {
    return (
      <StatCard action={action} label={id.ppob.saldo} value="—">
        <div role="alert" className="flex flex-col gap-0.5 text-sm">
          <p className="font-medium text-danger">Saldo tidak dapat dimuat</p>
          <p className="text-muted">{error.message}</p>
        </div>
      </StatCard>
    )
  }

  return (
    <StatCard action={action} label={id.ppob.saldo} value={formatRupiah(data?.saldo ?? 0)}>
      {data?.username ? (
        <p className="truncate text-sm text-muted">
          {id.ppob.connectionInfo}{" "}
          <span className="font-medium text-foreground">{data.username}</span>
        </p>
      ) : null}
    </StatCard>
  )
}
