import { Button, Skeleton } from "@heroui/react"
import { RefreshCw } from "lucide-react"

import { StatCard } from "@/components/stat-card"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { usePpobSaldo } from "../hooks"

/** Saldo Mitra di kepala halaman PPOB: `StatCard` dengan tombol muat-ulang di kanan. */
export function SaldoCard() {
  const { data, isLoading, error, refetch } = usePpobSaldo()

  const action = (
    <Button
      isIconOnly
      aria-label={id.common.reload}
      size="sm"
      variant="tertiary"
      onPress={() => refetch()}
    >
      <RefreshCw />
    </Button>
  )

  if (isLoading) {
    return (
      <StatCard action={action} label={id.ppob.saldo} value={<Skeleton className="h-8 w-32" />} />
    )
  }

  if (error) {
    return (
      <StatCard action={action} label={id.ppob.saldo} value="-">
        <p className="text-sm text-danger">{id.ppob.notConfigured}</p>
        <p className="text-sm text-muted">{id.ppob.configureInSettings}</p>
      </StatCard>
    )
  }

  return (
    <StatCard action={action} label={id.ppob.saldo} value={formatRupiah(data?.saldo ?? 0)}>
      <p className="text-sm text-muted">
        {id.ppob.connectionInfo}: {data?.username}
      </p>
    </StatCard>
  )
}
