import type { CompleteOnboardingInput, StoreInfo } from "@/features/onboarding/types"
import { apiGet, apiPost } from "./client"

/** `true` while the shop has not been set up yet. Public — there is nobody to authenticate as. */
export function getOnboardingStatus(): Promise<boolean> {
  return apiGet<boolean>("/onboarding/status")
}

export function completeOnboarding(input: CompleteOnboardingInput): Promise<StoreInfo> {
  return apiPost<StoreInfo>("/onboarding", input)
}
