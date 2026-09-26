import { useNavigate } from "react-router-dom"
import { Button } from "@heroui/react"
import { DatabaseBackupIcon, HistoryIcon, PackageIcon, ShoppingCartIcon } from "lucide-react"

import { NavbarActions, NavbarTitle } from "@/components/layout/app-navbar"
import { useAuthStore } from "@/features/auth"
import { useCreateBackupMutation } from "@/features/settings/hooks/use-backup"
import { IconActionButton } from "./icon-action-button"

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
 * Isi navbar untuk dashboard: sapaan sebagai judul, jalan pintas sebagai aksi.
 *
 * Tidak menggambar apa pun di badan halaman — keduanya portal ke navbar milik
 * `AppLayout`, tempat template dashboard HeroUI menaruh sapaan dan tombolnya.
 * Satu tombol `primary` di seluruh halaman, sesuai aturan HeroUI bahwa varian
 * itu menandai satu aksi utama per konteks. Sisanya `tertiary`: tujuannya
 * sudah ada di sidebar, jadi di sini cukup jadi jalan pintas.
 */
export function DashboardHeader() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const createBackup = useCreateBackupMutation()
  const isAdmin = user?.role === "admin"

  return (
    <>
      <NavbarTitle>
        {greeting(new Date().getHours())}
        {user ? `, ${user.full_name}` : ""}
      </NavbarTitle>
      <NavbarActions>
        <IconActionButton
          icon={<HistoryIcon />}
          label="Riwayat Transaksi"
          tooltipPlacement="bottom"
          onPress={() => navigate("/transactions")}
        />
        {isAdmin ? (
          <IconActionButton
            icon={<PackageIcon />}
            label="Kelola Produk"
            tooltipPlacement="bottom"
            onPress={() => navigate("/products")}
          />
        ) : null}
        {isAdmin ? (
          // Hasilnya diumumkan lewat toast dari `useCreateBackupMutation`;
          // selama berjalan tombolnya berputar dan tidak bisa ditekan dua kali.
          <IconActionButton
            icon={<DatabaseBackupIcon />}
            isPending={createBackup.isPending}
            label="Backup Sekarang"
            tooltipPlacement="bottom"
            onPress={() => createBackup.mutate(undefined)}
          />
        ) : null}
        <Button size="sm" onPress={() => navigate("/cashier")}>
          <ShoppingCartIcon />
          Mulai Penjualan
        </Button>
      </NavbarActions>
    </>
  )
}
