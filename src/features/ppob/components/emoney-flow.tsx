import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "./quick-access/ppob-quick-access"

export function EmoneyFlow() {
  const navigate = useNavigate()

  return (
    <PpobQuickAccess
      initialService="emoney"
      onBack={() => navigate("/ppob")}
      onItemAdded={() => navigate("/cashier")}
      showSaldoBar={false}
      wideLayout
    />
  )
}
