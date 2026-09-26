import { Card, Skeleton } from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { StatCard } from "@/components/stat-card"
import { CardHeading } from "../card-heading"

interface CloseShiftSkeletonProps {
  title: string
  onBack: () => void
}

/**
 * Bentuk halaman selagi ringkasan pertama dimuat — kartu yang sama dengan
 * `Skeleton` di tempat angkanya, supaya tata letak tidak melompat begitu data
 * datang.
 */
export function CloseShiftSkeleton({ title, onBack }: CloseShiftSkeletonProps) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <SubpageHeader title={title} onBack={onBack} />
      <span className="sr-only" role="status">
        Memuat ringkasan shift
      </span>
      <Card>
        <Card.Header>
          <CardHeading>Detail Kasir</CardHeading>
        </Card.Header>
        <Card.Content className="gap-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
        </Card.Content>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Transaksi" value={<Skeleton className="h-8 w-16" />} />
        <StatCard label="Total Penjualan" value={<Skeleton className="h-8 w-32" />} />
        <StatCard label="Saldo Aplikasi" value={<Skeleton className="h-8 w-32" />} />
      </div>
    </div>
  )
}
