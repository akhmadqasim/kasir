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
 * Baris paling atas dashboard: siapa yang sedang login, keadaan lacinya, dan
 * jalan pintas ke pekerjaan yang benar-benar sering dilakukan.
 *
 * Ini menggantikan kartu "Aksi Cepat" yang dulu memakan satu baris penuh untuk
 * empat tombol besar. Tombolnya sama, tapi tiga di antaranya cukup sebagai ikon
 * karena tujuannya juga ada di sidebar; yang benar-benar butuh ditekan setiap
 * pagi hanya satu, dan itu yang tetap berupa tombol utama bertulisan.
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
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">
          {greeting(new Date().getHours())}
          {user ? `, ${user.full_name}` : ""}
        </h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted">
          <span className="capitalize">{user?.role ?? "—"}</span>
          <span aria-hidden="true">·</span>
          <Chip color={activeShift ? "success" : "default"} size="sm" variant="soft">
            <Chip.Label>{activeShift ? "Shift terbuka" : "Shift belum dibuka"}</Chip.Label>
          </Chip>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          isIconOnly
          aria-label="Riwayat Transaksi"
          variant="outline"
          onPress={() => navigate("/transactions")}
        >
          <HistoryIcon />
        </Button>
        {isAdmin ? (
          <Button
            isIconOnly
            aria-label="Kelola Produk"
            variant="outline"
            onPress={() => navigate("/products")}
          >
            <PackageIcon />
          </Button>
        ) : null}
        {isAdmin ? (
          <Button
            isIconOnly
            aria-label="Backup Sekarang"
            isDisabled={createBackup.isPending}
            variant="outline"
            onPress={() => createBackup.mutate(undefined)}
          >
            <DatabaseBackupIcon />
          </Button>
        ) : null}
        <Button variant="primary" onPress={() => navigate("/cashier")}>
          <ShoppingCartIcon />
          Mulai Penjualan
        </Button>
      </div>
    </div>
  )
}
