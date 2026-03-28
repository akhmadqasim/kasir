import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "@/features/cashier/components/ppob-quick-access"

export function PdamFlow() {
  const navigate = useNavigate()

  return (
    <div className="p-6">
      <PpobQuickAccess
        initialService="pdam"
        onBack={() => navigate("/ppob")}
        onItemAdded={() => navigate("/cashier")}
        showSaldoBar={false}
        wideLayout
      />
    </div>
  )
}
