import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { id } from "@/i18n/id"
import { useCompleteOnboarding } from "../hooks/use-onboarding"
import { StoreInfoForm } from "./store-info-form"
import { AdminSetupForm } from "./admin-setup-form"
import type { SetupStoreInput, SetupAdminInput } from "../types"

export function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [storeData, setStoreData] = useState<SetupStoreInput | null>(null)
  const navigate = useNavigate()
  const completeMutation = useCompleteOnboarding()

  const t = id.onboarding

  const handleStoreNext = (data: SetupStoreInput) => {
    setStoreData(data)
    setStep(2)
  }

  const handleAdminSubmit = (adminData: SetupAdminInput) => {
    if (!storeData) return

    completeMutation.mutate(
      { store: storeData, admin: adminData },
      {
        onSuccess: () => {
          toast.success(t.success)
          navigate("/login")
        },
        onError: (error) => {
          toast.error(error.message || id.common.error)
        },
      }
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 px-4">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">{id.app.name}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        {step === 1 ? (
          <StoreInfoForm onNext={handleStoreNext} />
        ) : (
          <AdminSetupForm
            onSubmit={handleAdminSubmit}
            onBack={() => setStep(1)}
            isLoading={completeMutation.isPending}
          />
        )}
      </div>
    </div>
  )
}
