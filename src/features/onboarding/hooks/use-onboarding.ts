import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { id } from "@/i18n/id"
import { hasApiErrorCode } from "@/lib/api/client"
import { completeOnboarding, getOnboardingStatus } from "@/lib/api/onboarding"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/toast"
import type { StoreInfo } from "@/features/settings/types"
import type { CompleteOnboardingInput } from "../types"

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

/**
 * Registers the store and the first admin, then sends the user to login. The
 * follow-up sits on the mutation, since TanStack runs per-call callbacks only
 * for the latest call. A 409 means the store is already set up: login too.
 */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const finish = (message: string) => {
    // `AppGuard` is not mounted on `/onboarding`, so this query is inactive
    // and invalidating it alone changes nothing: the cached `true` is still
    // served on the first navigation and bounces the user straight back here.
    // Write the answer, then invalidate so it is reconfirmed once the guard
    // mounts.
    queryClient.setQueryData(queryKeys.onboarding.status, false)
    queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all })
    // The login screen may have cached `null` for the public store slice.
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.store })
    toast.success(message)
    navigate("/login")
  }

  return useApiMutation<StoreInfo, CompleteOnboardingInput>(completeOnboarding, {
    onSuccess: () => finish(id.onboarding.success),
    onError: (error) => {
      if (hasApiErrorCode(error, "conflict")) finish(id.onboarding.alreadyDone)
    },
  })
}
