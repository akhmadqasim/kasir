import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { completeOnboarding, getOnboardingStatus } from "@/lib/api/onboarding"
import { queryKeys } from "@/lib/api/query-keys"
import type { CompleteOnboardingInput, StoreInfo } from "../types"

export function useCheckOnboarding() {
  const { data, isLoading } = useApiQuery<boolean>(
    queryKeys.onboarding.status,
    getOnboardingStatus,
    { retry: false },
  )

  return {
    needsOnboarding: data === true,
    isLoading,
  }
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient()

  return useApiMutation<StoreInfo, CompleteOnboardingInput>(completeOnboarding, {
    onSuccess: () => {
      // `AppGuard` is not mounted on `/onboarding`, so this query is inactive
      // and invalidating it alone changes nothing: the cached `true` is still
      // served on the first navigation and bounces the user straight back here.
      // Write the answer, then invalidate so it is reconfirmed once the guard
      // mounts.
      queryClient.setQueryData(queryKeys.onboarding.status, false)
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all })
    },
  })
}
