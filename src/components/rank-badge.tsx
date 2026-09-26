import { cn } from "@/lib/utils"

interface RankBadgeProps {
  /** Peringkat, mulai dari 1. */
  rank: number
  className?: string
}

/**
 * Nomor urut di daftar yang terurut dari yang paling laku. Tiga teratas diberi
 * lingkaran aksen lembut — satu-satunya penanda di tabelnya — dan angkanya
 * sendiri tetap tertulis untuk semua baris, jadi warnanya tidak berdiri sendiri.
 */
export function RankBadge({ rank, className }: RankBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center text-xs",
        rank <= 3
          ? "rounded-full bg-accent-soft font-semibold text-accent-soft-foreground"
          : "text-muted",
        className,
      )}
    >
      {rank}
    </span>
  )
}
