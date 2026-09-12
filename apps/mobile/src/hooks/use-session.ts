import { hasApiErrorCode, type LoginInput, type User } from "@kasir/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { authApi } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

/**
 * Ask the server who we are, once per server, at boot.
 *
 * A 401 here is not an error — it is the ordinary answer before anybody has
 * logged in on this phone — so it becomes `user: null`. Anything else (server
 * down, LAN gone) also resolves to `null` so the guard can settle on the login
 * screen, where the next attempt surfaces the real message.
 */
export function useResolveSessionUser(): void {
  const serverOrigin = useSessionStore((state) => state.serverOrigin);
  const hydrated = useSessionStore((state) => state.hydrated);
  const userResolved = useSessionStore((state) => state.userResolved);

  useEffect(() => {
    if (!hydrated || !serverOrigin || userResolved) return;

    let cancelled = false;
    authApi
      .getCurrentUser()
      .then((user) => {
        if (!cancelled) useSessionStore.getState().setUser(user);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // `auth` is "nobody is logged in". Anything else — server down, LAN
        // gone — has no better answer at boot than the login screen either,
        // which reports the real message on the next attempt.
        if (!hasApiErrorCode(error, "auth")) {
          console.warn("[kasir] /auth/me failed at boot:", error);
        }
        useSessionStore.getState().clearUser();
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, serverOrigin, userResolved]);
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation<User, Error, LoginInput>({
    mutationFn: (input) => authApi.login(input),
    onSuccess: (user) => {
      // Whatever is cached belongs to whoever was logged in before on this phone.
      queryClient.removeQueries();
      useSessionStore.getState().setUser(user);
    },
  });
}

/**
 * End the session on the server, then locally.
 *
 * `onSettled` rather than `onSuccess`: if the request fails because the session
 * was already gone, the user still meant to log out and the screen still has to
 * follow them.
 */
export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      useSessionStore.getState().clearUser();
      queryClient.removeQueries();
    },
  });
}

/** The logged-in user, or throws — for screens the route guard already protects. */
export function useCurrentUser(): User {
  const user = useSessionStore((state) => state.user);
  if (!user) {
    throw new Error("useCurrentUser() rendered outside a protected route");
  }
  return user;
}
