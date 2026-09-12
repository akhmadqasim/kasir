import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "./quick-access/ppob-quick-access"

export function PdamFlow() {
  const navigate = useNavigate()

  return (
    <PpobQuickAccess
      initialService="pdam"
      onBack={() => navigate("/ppob")}
      onItemAdded={() => navigate("/cashier")}
      showSaldoBar={false}
      wideLayout
    />
  )
}
