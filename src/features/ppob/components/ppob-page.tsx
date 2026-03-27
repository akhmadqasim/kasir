import { Routes, Route, useNavigate } from "react-router-dom"
import {
  Smartphone,
  Zap,
  Droplets,
  HeartPulse,
  CreditCard,
  ArrowRightLeft,
  Wallet,
  Ticket,
  Wifi,
  RefreshCw,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { usePpobSaldo } from "../hooks/use-ppob"
import { PulsaFlow } from "./pulsa-flow"
import { PlnFlow } from "./pln-flow"

const services = [
  { key: "pulsa", icon: Smartphone, label: id.ppob.pulsa, path: "pulsa", color: "text-blue-500" },
  { key: "data", icon: Wifi, label: id.ppob.dataPacket, path: "data", color: "text-purple-500" },
  { key: "pln", icon: Zap, label: id.ppob.pln, path: "pln", color: "text-yellow-500" },
  { key: "pdam", icon: Droplets, label: id.ppob.pdam, path: "pdam", color: "text-cyan-500" },
  { key: "bpjs", icon: HeartPulse, label: id.ppob.bpjs, path: "bpjs", color: "text-red-500" },
  { key: "pp", icon: CreditCard, label: id.ppob.pp, path: "pp", color: "text-green-500" },
  { key: "transfer", icon: ArrowRightLeft, label: id.ppob.transfer, path: "transfer", color: "text-orange-500" },
  { key: "emoney", icon: Wallet, label: id.ppob.emoney, path: "emoney", color: "text-pink-500" },
  { key: "voucher", icon: Ticket, label: id.ppob.voucher, path: "voucher", color: "text-indigo-500" },
] as const

function SaldoCard() {
  const { data, isLoading, error, refetch } = usePpobSaldo()

  if (error) {
    return (
      <Card className="mb-6">
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
    <Card className="mb-6">
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
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5">
      {services.map((svc) => (
        <Card
          key={svc.key}
          className="cursor-pointer transition-colors hover:bg-accent"
          onClick={() => navigate(svc.path)}
        >
          <CardContent className="flex flex-col items-center gap-2 py-6">
            <svc.icon className={`h-8 w-8 ${svc.color}`} />
            <span className="text-sm font-medium text-center">{svc.label}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function PpobHome() {
  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">{id.ppob.title}</h1>
      <SaldoCard />
      <h2 className="text-lg font-semibold mb-4">{id.ppob.selectService}</h2>
      <ServiceGrid />
    </div>
  )
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground mt-2">Coming soon...</p>
    </div>
  )
}

export function PpobPage() {
  return (
    <Routes>
      <Route index element={<PpobHome />} />
      <Route path="pulsa" element={<PulsaFlow />} />
      <Route path="data" element={<ComingSoon title={id.ppob.dataPacket} />} />
      <Route path="pln" element={<PlnFlow />} />
      <Route path="pdam" element={<ComingSoon title={id.ppob.pdam} />} />
      <Route path="bpjs" element={<ComingSoon title={id.ppob.bpjs} />} />
      <Route path="pp" element={<ComingSoon title={id.ppob.pp} />} />
      <Route path="transfer" element={<ComingSoon title={id.ppob.transfer} />} />
      <Route path="emoney" element={<ComingSoon title={id.ppob.emoney} />} />
      <Route path="voucher" element={<ComingSoon title={id.ppob.voucher} />} />
    </Routes>
  )
}
