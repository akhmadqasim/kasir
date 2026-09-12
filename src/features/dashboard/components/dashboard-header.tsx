import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Chip } from "@heroui/react"
import { DatabaseBackupIcon, HistoryIcon, PackageIcon, ShoppingCartIcon } from "lucide-react"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCreateBackupMutation } from "@/features/settings/hooks/use-backup"

/**
 * Sapaan mengikuti jam dinding kasir, memakai pembagian waktu yang dipakai
 * sehari-hari di Indonesia — bukan terjemahan dari morning/afternoon/evening,
 * yang batasnya berbeda dan membuat "selamat sore" muncul jam dua siang.
 */
function greeting(hour: number): string {
  if (hour < 11) return "Selamat pagi"
  if (hour < 15) return "Selamat siang"
  if (hour < 19) return "Selamat sore"
  return "Selamat malam"
}

/**
 * Baris paling atas dashboard: siapa yang login, keadaan lacinya, dan jalan
 * pintas ke pekerjaan yang benar-benar sering dilakukan.
 *
 * Satu tombol `primary` di seluruh halaman, sesuai aturan HeroUI bahwa varian
 * itu menandai satu aksi utama per konteks. Sisanya `tertiary`: tujuannya sudah
 * ada di sidebar, jadi di sini cukup jadi jalan pintas yang tidak menarik mata.
 */
export function DashboardHeader() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const activeShift = useShiftStore((s) => s.activeShift)
  const fetchActiveShift = useShiftStore((s) => s.fetchActiveShift)
  const createBackup = useCreateBackupMutation()
  const isAdmin = user?.role === "admin"

  useEffect(() => {
    if (user) {
      void fetchActiveShift()
    }
  }, [user, fetchActiveShift])

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-xl font-semibold">
          {greeting(new Date().getHours())}
          {user ? `, ${user.full_name}` : ""}
        </h1>
        <Chip color={activeShift ? "success" : "default"} size="sm">
          {activeShift ? "Shift terbuka" : "Shift belum dibuka"}
        </Chip>
      </div>

      <div className="flex items-center gap-2">
        <Button
          isIconOnly
          aria-label="Riwayat Transaksi"
          variant="tertiary"
          onPress={() => navigate("/transactions")}
        >
          <HistoryIcon />
        </Button>
        {isAdmin ? (
          <Button
            isIconOnly
            aria-label="Kelola Produk"
            variant="tertiary"
            onPress={() => navigate("/products")}
          >
            <PackageIcon />
          </Button>
        ) : null}
        {isAdmin ? (
          <Button
            isIconOnly
            aria-label="Backup Sekarang"
            isPending={createBackup.isPending}
            variant="tertiary"
            onPress={() => createBackup.mutate(undefined)}
          >
            <DatabaseBackupIcon />
          </Button>
        ) : null}
        <Button onPress={() => navigate("/cashier")}>
          <ShoppingCartIcon />
          Mulai Penjualan
        </Button>
      </div>
    </div>
  )
}
