import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "@/features/cashier/components/ppob-quick-access"

export function DataFlow() {
  const navigate = useNavigate()

  return (
    <div className="p-6">
      <PpobQuickAccess
        initialService="data"
        onBack={() => navigate("/ppob")}
        onItemAdded={() => navigate("/cashier")}
        showSaldoBar={false}
        wideLayout
      />
    </div>
  )
}
