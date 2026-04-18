import { Routes, Route, useNavigate } from "react-router-dom"
import {
  RefreshCw,
  History,
  ArrowUpDown,
  Bell,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { usePpobSaldo } from "../hooks"
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
import { PpobHistory } from "./history"
import { PpobMutasi } from "./mutasi"
import { PpobNotifications } from "./notifications"

function SaldoCard() {
  const { data, isLoading, error, refetch } = usePpobSaldo()

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm text-muted-foreground">{id.ppob.saldo}</p>
            <p className="text-sm text-destructive">{id.ppob.notConfigured}</p>
            <p className="text-xs text-muted-foreground">{id.ppob.configureInSettings}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <p className="text-sm text-muted-foreground">{id.ppob.saldo}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <>
              <p className="text-2xl font-bold">
                Rp {data?.saldo.toLocaleString("id-ID") ?? "0"}
              </p>
              <p className="text-xs text-muted-foreground">
                {id.ppob.connectionInfo}: {data?.username}
              </p>
            </>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

function ServiceGrid() {
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {PPOB_SERVICES.map((svc) => (
        <button
          key={svc.key}
          className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => navigate(svc.path)}
        >
          <svc.icon className={`h-7 w-7 ${svc.color}`} />
          <span className="text-sm font-medium text-center">{svc.label}</span>
        </button>
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
          <Button variant="outline" size="sm" onClick={() => navigate("notifications")}>
            <Bell className="mr-2 h-4 w-4" />
            {id.ppob.notifications}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("mutasi")}>
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {id.ppob.mutasi}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("history")}>
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
