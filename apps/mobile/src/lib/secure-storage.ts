import * as SecureStore from "expo-secure-store";
import type { StateStorage } from "zustand/middleware";

/**
 * `expo-secure-store` as a Zustand `persist` backend.
 *
 * Only the server address is ever written here (see `session-store.ts`). The
 * session itself is an `HttpOnly` cookie in the platform cookie jar, which
 * this code never sees, and the PIN is never stored anywhere.
 */
export const secureStorage: StateStorage = {
  getItem: (name) => SecureStore.getItemAsync(name),
  setItem: (name, value) => SecureStore.setItemAsync(name, value),
  removeItem: (name) => SecureStore.deleteItemAsync(name),
};
