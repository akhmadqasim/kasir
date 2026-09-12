import type { User } from "@kasir/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { secureStorage } from "@/lib/secure-storage";

/**
 * Which desktop this phone talks to, and who is logged in.
 *
 * Only `serverOrigin` is persisted (to `expo-secure-store`). `user` is asked of
 * the server at boot via `GET /auth/me` — the session is a cookie the platform
 * keeps for us — so a stale user can never be shown from local storage, and
 * there is no PIN to persist because the app never holds one past the login
 * request.
 */
export interface SessionState {
  /** `http://host:port`, without a path. `null` until the user picks a server. */
  serverOrigin: string | null;
  /** The account behind the current cookie. `null` when nobody is logged in. */
  user: User | null;
  /** True once `/auth/me` has answered (either way) for the current server. */
  userResolved: boolean;
  /** True once the persisted server address has been read back from secure storage. */
  hydrated: boolean;
  /** Pengaturan → "Ganti server" opens the setup screen while a server is still set. */
  changingServer: boolean;
  setServerOrigin: (origin: string | null) => void;
  setChangingServer: (changing: boolean) => void;
  setUser: (user: User | null) => void;
  clearUser: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      serverOrigin: null,
      user: null,
      userResolved: false,
      hydrated: false,
      changingServer: false,
      setServerOrigin: (serverOrigin) =>
        // A new server means a new cookie jar entry and a new "who am I".
        set({ serverOrigin, user: null, userResolved: false, changingServer: false }),
      setChangingServer: (changingServer) => set({ changingServer }),
      setUser: (user) => set({ user, userResolved: true }),
      clearUser: () => set({ user: null, userResolved: true }),
    }),
    {
      name: "kasir.session",
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ serverOrigin: state.serverOrigin }),
      onRehydrateStorage: () => (state) => {
        // Runs after the stored slice is merged in. Everything not persisted
        // keeps its initial value, so `userResolved` is still false here and the
        // root layout knows to ask `/auth/me`.
        useSessionStore.setState({ hydrated: true, userResolved: !state?.serverOrigin });
      },
    }
  )
);

/** `http://host:port/api` for the current server, or `null`. */
export function selectApiBaseUrl(state: SessionState): string | null {
  return state.serverOrigin ? `${state.serverOrigin}/api` : null;
}
