import { useState } from "react"
import { id } from "@/i18n/id"
import { hasApiErrorCode } from "@/lib/api/client"
import { AuthScreen } from "@/components/auth-card"
import { useCompleteOnboarding } from "../hooks/use-onboarding"
import { StoreInfoForm } from "./store-info-form"
import { AdminSetupForm } from "./admin-setup-form"
import type { SetupStoreInput, SetupAdminInput } from "../types"

export function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [storeData, setStoreData] = useState<SetupStoreInput | null>(null)
  const [adminData, setAdminData] = useState<SetupAdminInput | null>(null)
  // Navigates to login itself, on success and on "already set up" (409).
  const completeMutation = useCompleteOnboarding()

  const handleStoreNext = (data: SetupStoreInput) => {
    setStoreData(data)
    setStep(2)
  }

  const handleAdminSubmit = (data: SetupAdminInput) => {
    if (!storeData || completeMutation.isPending) return
    setAdminData(data)
    completeMutation.mutate({ store: storeData, admin: data })
  }

  // A 409 is on its way to the login screen (see `useCompleteOnboarding`),
  // not an error to fix in the form.
  const { error } = completeMutation
  const submitError =
    error && !hasApiErrorCode(error, "conflict") ? error.message || id.common.error : null

  return (
    <AuthScreen>
      {step === 1 ? (
        <StoreInfoForm onNext={handleStoreNext} initialData={storeData} />
      ) : (
        <AdminSetupForm
          onSubmit={handleAdminSubmit}
          onBack={(data) => {
            setAdminData(data)
            // The old failure belongs to the old attempt; do not greet the
            // user with it when they come back to this step.
            completeMutation.reset()
            setStep(1)
          }}
          isLoading={completeMutation.isPending}
          initialData={adminData}
          submitError={submitError}
        />
      )}
    </AuthScreen>
  )
}
