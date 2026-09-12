import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "./quick-access/ppob-quick-access"

export function BpjsFlow() {
  const navigate = useNavigate()

  return (
    <PpobQuickAccess
      initialService="bpjs"
      onBack={() => navigate("/ppob")}
      onItemAdded={() => navigate("/cashier")}
      showSaldoBar={false}
      wideLayout
    />
  )
}
