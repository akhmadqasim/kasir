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
        // AppGuard is not mounted on /onboarding, so this query is inactive and
        // invalidating it changes nothing: the cached `true` is still served on the
        // first navigation and bounces the user straight back here. Write the answer
        // directly, then invalidate so it is reconfirmed once the guard mounts.
        queryClient.setQueriesData(
          { queryKey: ["check_onboarding_status"] },
          false
        )
        queryClient.invalidateQueries({ queryKey: ["check_onboarding_status"] })
      },
    }
  )
}
