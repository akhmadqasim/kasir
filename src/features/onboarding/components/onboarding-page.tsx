import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { useCompleteOnboarding } from "../hooks/use-onboarding"
import { StoreInfoForm } from "./store-info-form"
import { AdminSetupForm } from "./admin-setup-form"
import type { SetupStoreInput, SetupAdminInput } from "../types"

export function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [storeData, setStoreData] = useState<SetupStoreInput | null>(null)
  const [adminData, setAdminData] = useState<SetupAdminInput | null>(null)
  const navigate = useNavigate()
  const completeMutation = useCompleteOnboarding()

  const t = id.onboarding

  const handleStoreNext = (data: SetupStoreInput) => {
    setStoreData(data)
    setStep(2)
  }

  const handleAdminSubmit = (data: SetupAdminInput) => {
    if (!storeData) return
    setAdminData(data)

    completeMutation.mutate(
      { store: storeData, admin: data },
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
    <div className="flex min-h-svh flex-col items-center justify-center bg-default p-6 md:p-10 overflow-y-auto">
      <div className="w-full max-w-sm md:max-w-4xl">
        {step === 1 ? (
          <div className="animate-in fade-in duration-300">
            <StoreInfoForm onNext={handleStoreNext} initialData={storeData} />
          </div>
        ) : (
          <div className="animate-in fade-in duration-300">
            <AdminSetupForm
              onSubmit={handleAdminSubmit}
              onBack={(data) => {
                setAdminData(data)
                setStep(1)
              }}
              isLoading={completeMutation.isPending}
              initialData={adminData}
            />
          </div>
        )}
      </div>
    </div>
  )
}
