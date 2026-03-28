import { useNavigate } from "react-router-dom"
import { PpobQuickAccess } from "@/features/cashier/components/ppob-quick-access"

export function BpjsFlow() {
  const navigate = useNavigate()

  return (
    <div className="p-6">
      <PpobQuickAccess
        initialService="bpjs"
        onBack={() => navigate("/ppob")}
        onItemAdded={() => navigate("/cashier")}
        showSaldoBar={false}
      />
    </div>
  )
}
