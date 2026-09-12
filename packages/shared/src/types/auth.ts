// Copied from the desktop's `src/features/auth/types.ts`.

export interface User {
  id: number
  username: string
  full_name: string
  role: "admin" | "kasir"
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LoginInput {
  username: string
  pin: string
}

export interface ChangeOwnPinInput {
  currentPin: string
  newPin: string
}
