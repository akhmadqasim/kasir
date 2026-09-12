import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import * as authApi from "@/lib/api/auth"
import { hasApiErrorCode } from "@/lib/api/client"
import { queryKeys } from "@/lib/api/query-keys"
import { flushPendingLogs } from "@/lib/startup-logger"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { useAuthStore } from "./use-auth-store"
import type { LoginInput, User } from "../types"

/**
 * Ask the server who we are, once, at boot.
 *
 * This is the only place the application learns its own identity. A 401 here is
 * not an error — it is the ordinary answer before anybody has logged in — so it
 * becomes `null` rather than a thrown failure, and the request opts out of the
 * global session handler for the same reason.
 *
 * `staleTime: Infinity` keeps it from refetching: the answer only changes when
 * this code changes it, at login, at logout, and when a 401 elsewhere reveals
 * that the session has gone.
 */
export function useCurrentUser() {
  return useApiQuery<User | null>(queryKeys.auth.me, fetchSessionUser, {
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/**
 * The store is written here rather than from an effect, and the difference is
 * not stylistic.
 *
 * An effect runs *after* React has committed the render that first saw
 * `isPending: false`. For one frame the guard would have a resolved query and an
 * empty store, read that as "not logged in", and redirect a perfectly valid
 * session to the login screen. Writing from inside the query function happens
 * before React Query publishes the result, so the two are never out of step.
 */
async function fetchSessionUser(): Promise<User | null> {
  try {
    const user = await authApi.getCurrentUser()
    useAuthStore.getState().setUser(user)
    return user
  } catch (error) {
    if (hasApiErrorCode(error, "auth")) {
      useAuthStore.getState().setUser(null)
      return null
    }
    throw error
  }
}

export function useLogin() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setUser = useAuthStore((state) => state.setUser)

  return useApiMutation<User, LoginInput>((input) => authApi.login(input), {
    onSuccess: (user) => {
      // Whatever is cached belongs to whoever was logged in before. Two cashiers
      // sharing a till is the normal case here, so dropping it is not a
      // precaution — it is the difference between the second one seeing their
      // own shift and seeing the first one's.
      //
      // `removeQueries` rather than `clear`: the latter also empties the
      // mutation cache, and this code is running inside a mutation.
      queryClient.removeQueries()
      queryClient.setQueryData(queryKeys.auth.me, user)
      setUser(user)
      // `POST /api/logs` needs a session, so anything logged during boot has
      // been waiting in the buffer for this moment.
      flushPendingLogs()
      navigate("/")
    },
    onError: (error) => {
      toast.error(error.message || id.common.error)
    },
  })
}

/**
 * End the session on the server, then locally.
 *
 * `onSettled` rather than `onSuccess`: if the request fails because the session
 * was already gone, the user still meant to log out and the screen still has to
 * follow them.
 */
export function useLogout() {
  const queryClient = useQueryClient()
  const clearUser = useAuthStore((state) => state.clearUser)

  return useApiMutation<void, void>(() => authApi.logout(), {
    onSettled: () => {
      clearUser()
      queryClient.removeQueries()
      queryClient.setQueryData(queryKeys.auth.me, null)
    },
  })
}

/** Change your own PIN. The current one is the proof; no id is sent. */
export function useChangeOwnPin() {
  return useApiMutation<void, authApi.ChangeOwnPinInput>((input) => authApi.changeOwnPin(input), {
    onSuccess: () => {
      toast.success(id.profile.pinChanged)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}
