import { Routes, Route, useNavigate } from "react-router-dom"
import { Button, Card } from "@heroui/react"
import { History, ArrowUpDown, Bell } from "lucide-react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { id } from "@/i18n/id"
import { PPOB_SERVICES } from "../constants"
import { PulsaFlow } from "./pulsa-flow"
import { DataFlow } from "./data-flow"
import { PlnFlow } from "./pln-flow"
import { PdamFlow } from "./pdam-flow"
import { BpjsFlow } from "./bpjs-flow"
import { PpFlow } from "./pp-flow"
import { TransferFlow } from "./transfer-flow"
import { EmoneyFlow } from "./emoney-flow"
import { VoucherFlow } from "./voucher-flow"
import { SaldoCard } from "./saldo-card"
import { ServiceGrid } from "./service-grid"
import { PpobHistory } from "./history"
import { PpobMutasi } from "./mutasi"
import { PpobNotifications } from "./notifications"

/**
 * Judul "Mitra Indogrosir" sudah digambar navbar dari daftar navigasi; yang
 * naik dari halaman ini hanya tiga jalan pintasnya, sebagai tombol ikon `sm
 * tertiary` (DESIGN.md §5.1).
 */
function PpobHome() {
  const navigate = useNavigate()

  return (
    <>
      <NavbarActions>
        <Button
          isIconOnly
          aria-label={id.ppob.notifications}
          size="sm"
          variant="tertiary"
          onPress={() => navigate("notifications")}
        >
          <Bell />
        </Button>
        <Button
          isIconOnly
          aria-label={id.ppob.mutasi}
          size="sm"
          variant="tertiary"
          onPress={() => navigate("mutasi")}
        >
          <ArrowUpDown />
        </Button>
        <Button
          isIconOnly
          aria-label={id.ppob.history}
          size="sm"
          variant="tertiary"
          onPress={() => navigate("history")}
        >
          <History />
        </Button>
      </NavbarActions>

      <div className="flex flex-col gap-6">
        <SaldoCard />
        <Card>
          <Card.Header>
            <Card.Title>{id.ppob.selectService}</Card.Title>
          </Card.Header>
          <Card.Content>
            <ServiceGrid services={PPOB_SERVICES} onSelect={(service) => navigate(service.path)} />
          </Card.Content>
        </Card>
      </div>
    </>
  )
}

export function PpobPage() {
  return (
    <Routes>
      <Route index element={<PpobHome />} />
      <Route path="pulsa" element={<PulsaFlow />} />
      <Route path="data" element={<DataFlow />} />
      <Route path="pln" element={<PlnFlow />} />
      <Route path="pdam" element={<PdamFlow />} />
      <Route path="bpjs" element={<BpjsFlow />} />
      <Route path="pp" element={<PpFlow />} />
      <Route path="transfer" element={<TransferFlow />} />
      <Route path="emoney" element={<EmoneyFlow />} />
      <Route path="voucher" element={<VoucherFlow />} />
      <Route path="history" element={<PpobHistory />} />
      <Route path="mutasi" element={<PpobMutasi />} />
      <Route path="notifications" element={<PpobNotifications />} />
    </Routes>
  )
}
