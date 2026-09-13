import { useNavigate } from "react-router-dom"
import { Button, Card } from "@heroui/react"
import { ArrowUpDown, Bell, Settings } from "lucide-react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { useAuthStore } from "@/features/auth"
import { id } from "@/i18n/id"
import { PPOB_SERVICES } from "../constants"
import { HistoryPanel } from "./history"
import { SaldoCard } from "./saldo-card"
import { ServiceGrid } from "./service-grid"

/**
 * Beranda Mitra Indogrosir: menu layanan di kiri, riwayat transaksi di kanan,
 * keduanya terlihat sekaligus di layar kasir; di bawah `lg` keduanya bertumpuk.
 *
 * Judul "Mitra Indogrosir" sudah digambar navbar dari daftar navigasi; yang
 * naik dari halaman ini hanya jalan pintasnya, sebagai tombol `sm tertiary`
 * berikon dan berlabel (DESIGN.md §5.1) — ikon saja membuat kasir menebak
 * mana mutasi dan mana notifikasi. Pengaturan hanya untuk admin, mengikuti
 * `AdminRouteGuard` di rutenya.
 */
export function PpobHome() {
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")

  return (
    <>
      <NavbarActions>
        <Button size="sm" variant="tertiary" onPress={() => navigate("notifications")}>
          <Bell />
          Notifikasi
        </Button>
        <Button size="sm" variant="tertiary" onPress={() => navigate("mutasi")}>
          <ArrowUpDown />
          Mutasi
        </Button>
        {isAdmin && (
          <Button size="sm" variant="tertiary" onPress={() => navigate("settings")}>
            <Settings />
            {id.nav.settings}
          </Button>
        )}
      </NavbarActions>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Kolom menu jauh lebih pendek dari riwayat sebulan; ia ikut menempel
            saat riwayat digulir, seperti kolom ringkasan di `FlowColumns`. */}
        <div className="flex flex-col gap-6 lg:sticky lg:top-0 lg:self-start">
          <SaldoCard />
          <Card>
            <Card.Header>
              <Card.Title>{id.ppob.selectService}</Card.Title>
            </Card.Header>
            <Card.Content>
              <ServiceGrid
                services={PPOB_SERVICES}
                onSelect={(service) => navigate(service.path)}
              />
            </Card.Content>
          </Card>
        </div>
        <HistoryPanel />
      </div>
    </>
  )
}
