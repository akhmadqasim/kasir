import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { createUser, listUsers, setUserActive, updateUser } from "@/lib/api/users"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth"
import type { User } from "@/features/auth/types"
import type { CreateUserInput, ToggleUserActiveInput, UpdateUserInput } from "../types"

/** The list is admin-only on the server; there is no caller id to pass any more. */
export function useUsers() {
  return useApiQuery<User[]>(queryKeys.users.list, listUsers)
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useApiMutation<User, CreateUserInput>(createUser, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success(id.users.createSuccess)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useApiMutation<User, UpdateUserInput>(updateUser, {
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      // `auth.me` never refetches on its own, so an admin editing their own
      // account would keep the old name in the sidebar until the next login.
      if (updated.id === useAuthStore.getState().user?.id) {
        useAuthStore.getState().setUser(updated)
        queryClient.setQueryData(queryKeys.auth.me, updated)
      }
      toast.success(id.users.updateSuccess)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useToggleUserActive() {
  const queryClient = useQueryClient()

  return useApiMutation<User, ToggleUserActiveInput>(
    ({ userId, isActive }) => setUserActive(userId, isActive),
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
        toast.success(variables.isActive ? id.users.activateSuccess : id.users.deactivateSuccess)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    },
  )
}
