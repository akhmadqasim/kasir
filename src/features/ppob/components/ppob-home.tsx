import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Card } from "@heroui/react"
import { ArrowUpDown, Bell, Settings } from "lucide-react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { SearchInput } from "@/components/search-input"
import { useAuthStore } from "@/features/auth"
import { id } from "@/i18n/id"
import { PPOB_SERVICES, type PpobServiceDef } from "../constants"
import { usePaymentPointSearch } from "../hooks"
import type { PpSearchResult } from "../types"
import { HistoryPanel } from "./history"
import { SaldoCard } from "./saldo-card"
import { SearchResultsGrid } from "./search-results-grid"
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
  const [search, setSearch] = useState("")
  const { data: billers, isLoading: billersLoading } = usePaymentPointSearch(search)

  const handleSelectService = (service: PpobServiceDef) => navigate(service.path)

  // A biller found by search skips the group step: `pp-flow.tsx` reads
  // `location.state` and starts on that group directly (its id and name are
  // already known here), then auto-selects the merchant once its own
  // sub-menu fetch resolves — so the cashier only has to type the payment code.
  const handleSelectBiller = (item: PpSearchResult) =>
    navigate("pp", { state: { preselectGroup: item.group, preselectItemId: item.id } })

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
            <Card.Content className="gap-4">
              <SearchInput
                aria-label={id.ppob.searchService}
                placeholder={id.ppob.searchService}
                value={search}
                onChange={setSearch}
              />
              {search.trim() ? (
                <SearchResultsGrid
                  billers={billers}
                  isLoading={billersLoading}
                  query={search}
                  onSelectBiller={handleSelectBiller}
                  onSelectService={handleSelectService}
                />
              ) : (
                <ServiceGrid services={PPOB_SERVICES} onSelect={handleSelectService} />
              )}
            </Card.Content>
          </Card>
        </div>
        <HistoryPanel />
      </div>
    </>
  )
}
