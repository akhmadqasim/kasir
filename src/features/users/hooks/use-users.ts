import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { id } from "@/i18n/id"
import type { User } from "@/features/auth/types"
import type { CreateUserInput, UpdateUserInput, ToggleUserActiveInput } from "../types"

export function useUsers(callerId: number) {
  return useTauriQuery<User[]>("list_users", { callerId })
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useTauriMutation<User, { input: CreateUserInput; callerId: number }>("create_user", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list_users"] })
      toast.success(id.users.createSuccess)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useTauriMutation<User, { input: UpdateUserInput; callerId: number }>("update_user", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list_users"] })
      toast.success(id.users.updateSuccess)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useToggleUserActive() {
  const queryClient = useQueryClient()

  return useTauriMutation<User, ToggleUserActiveInput>("toggle_user_active", {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["list_users"] })
      toast.success(
        variables.isActive
          ? id.users.activateSuccess
          : id.users.deactivateSuccess
      )
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useChangePin() {
  return useTauriMutation<void, { userId: number; currentPin: string; newPin: string }>(
    "change_user_pin",
    {
      onSuccess: () => {
        toast.success(id.profile.pinChanged)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    }
  )
}
