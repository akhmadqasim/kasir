export interface SetupStoreInput {
  name: string
  address?: string
  phone?: string
  email?: string
}

export interface SetupAdminInput {
  username: string
  pin: string
  full_name: string
}

export interface CompleteOnboardingInput {
  store: SetupStoreInput
  admin: SetupAdminInput
}
