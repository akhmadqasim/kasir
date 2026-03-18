import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useTauriMutation } from "@/hooks/use-tauri-command"
import { id } from "@/i18n/id"
import { useAuthStore } from "./use-auth-store"
import type { LoginInput, User } from "../types"

export function useLogin() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  return useTauriMutation<User, LoginInput>("login", {
    onSuccess: (user) => {
      login(user)
      navigate("/")
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}
