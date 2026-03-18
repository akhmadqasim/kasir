import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type { CompleteOnboardingInput } from "../types"

export function useCheckOnboarding() {
  const { data, isLoading } = useTauriQuery<boolean>(
    "check_onboarding_status",
    undefined,
    { retry: false }
  )

  return {
    needsOnboarding: data === true,
    isLoading,
  }
}

export function useCompleteOnboarding() {
  return useTauriMutation<void, CompleteOnboardingInput>("complete_onboarding")
}
