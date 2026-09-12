import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "./quick-access/ppob-quick-access"

export function DataFlow() {
  const navigate = useNavigate()

  return (
    <PpobQuickAccess
      initialService="data"
      onBack={() => navigate("/ppob")}
      onItemAdded={() => navigate("/cashier")}
      showSaldoBar={false}
      wideLayout
    />
  )
}
