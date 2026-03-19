import { useQueryClient } from "@tanstack/react-query"
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
  const queryClient = useQueryClient()
  return useTauriMutation<void, { input: CompleteOnboardingInput }>(
    "complete_onboarding",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["check_onboarding_status"] })
      },
    }
  )
}
