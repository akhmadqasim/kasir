import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "./quick-access/ppob-quick-access"

export function PlnFlow() {
  const navigate = useNavigate()

  return (
    <PpobQuickAccess
      initialService="pln"
      onBack={() => navigate("/ppob")}
      onItemAdded={() => navigate("/cashier")}
      showSaldoBar={false}
      wideLayout
    />
  )
}
