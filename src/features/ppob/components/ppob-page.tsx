import { Routes, Route, useNavigate } from "react-router-dom"
import { Button, Card, Skeleton } from "@heroui/react"
import { RefreshCw, History, ArrowUpDown, Bell } from "lucide-react"

import { id } from "@/i18n/id"
import { usePpobSaldo } from "../hooks"
import { PPOB_SERVICES, PPOB_SERVICE_COLORS } from "../constants"
import { PulsaFlow } from "./pulsa-flow"
import { DataFlow } from "./data-flow"
import { PlnFlow } from "./pln-flow"
import { PdamFlow } from "./pdam-flow"
import { BpjsFlow } from "./bpjs-flow"
import { PpFlow } from "./pp-flow"
import { TransferFlow } from "./transfer-flow"
import { EmoneyFlow } from "./emoney-flow"
import { VoucherFlow } from "./voucher-flow"
import { PpobHistory } from "./history"
import { PpobMutasi } from "./mutasi"
import { PpobNotifications } from "./notifications"

function SaldoCard() {
  const { data, isLoading, error, refetch } = usePpobSaldo()

  if (error) {
    return (
      <Card>
        <Card.Content className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm text-muted">{id.ppob.saldo}</p>
            <p className="text-sm text-danger">{id.ppob.notConfigured}</p>
            <p className="text-xs text-muted">{id.ppob.configureInSettings}</p>
          </div>
        </Card.Content>
      </Card>
    )
  }

  return (
    <Card>
      <Card.Content className="flex items-center justify-between py-4">
        <div>
          <p className="text-sm text-muted">{id.ppob.saldo}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <>
              <p className="text-2xl font-bold">Rp {data?.saldo.toLocaleString("id-ID") ?? "0"}</p>
              <p className="text-xs text-muted">
                {id.ppob.connectionInfo}: {data?.username}
              </p>
            </>
          )}
        </div>
        <Button
          aria-label="Muat ulang saldo"
          isIconOnly
          variant="tertiary"
          onPress={() => refetch()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </Card.Content>
    </Card>
  )
}

function ServiceGrid() {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {PPOB_SERVICES.map((svc) => (
        <Button
          key={svc.key}
          className="h-auto flex-col gap-2 p-4"
          variant="secondary"
          onPress={() => navigate(svc.path)}
        >
          <svc.icon className={`h-7 w-7 ${PPOB_SERVICE_COLORS[svc.key].text}`} />
          <span className="text-center text-sm font-medium">{svc.label}</span>
        </Button>
      ))}
    </div>
  )
}

function PpobHome() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{id.ppob.title}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onPress={() => navigate("notifications")}>
            <Bell className="mr-2 h-4 w-4" />
            {id.ppob.notifications}
          </Button>
          <Button size="sm" variant="secondary" onPress={() => navigate("mutasi")}>
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {id.ppob.mutasi}
          </Button>
          <Button size="sm" variant="secondary" onPress={() => navigate("history")}>
            <History className="mr-2 h-4 w-4" />
            {id.ppob.history}
          </Button>
        </div>
      </div>
      <SaldoCard />
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{id.ppob.selectService}</h2>
        <ServiceGrid />
      </div>
    </div>
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
