export interface CreateUserInput {
  username: string
  fullName: string
  role: "admin" | "kasir"
  pin: string
}

export interface UpdateUserInput {
  userId: number
  username?: string
  fullName?: string
  role?: "admin" | "kasir"
  newPin?: string
}

export interface ToggleUserActiveInput {
  userId: number
  isActive: boolean
  currentUserId: number
}
