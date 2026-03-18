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

export interface StoreInfo {
  id: number
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_path: string | null
  additional_info: string | null
  created_at: string
  updated_at: string
}
