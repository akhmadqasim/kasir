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
