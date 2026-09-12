import { id } from "@kasir/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider, Spinner } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import "../global.css";

import { useResolveSessionUser } from "@/hooks/use-session";
import { queryClient } from "@/lib/query-client";
import { useSessionStore } from "@/stores/session-store";

/**
 * Three states, three groups of screens, guarded by `Stack.Protected`:
 *
 * 1. no server chosen        → `server-setup`
 * 2. server, nobody logged in → `login`
 * 3. logged in               → tabs and the product screens
 *
 * `server-setup` stays reachable from Pengaturan via `changingServer`, so a
 * shop with two tills can switch. Guards flip from store changes alone;
 * nothing navigates to the login screen by hand, which is what keeps a 401
 * from looping.
 */
function RootNavigator(): JSX.Element {
  const hydrated = useSessionStore((state) => state.hydrated);
  const serverOrigin = useSessionStore((state) => state.serverOrigin);
  const user = useSessionStore((state) => state.user);
  const userResolved = useSessionStore((state) => state.userResolved);
  const changingServer = useSessionStore((state) => state.changingServer);

  useResolveSessionUser();

  if (!hydrated || (serverOrigin && !userResolved)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }

  const hasServer = serverOrigin !== null;
  const loggedIn = hasServer && user !== null;

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Protected guard={!hasServer || changingServer}>
        <Stack.Screen name="server-setup" options={{ title: id.server.title }} />
      </Stack.Protected>

      <Stack.Protected guard={hasServer && !loggedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={loggedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="products/[id]/index" options={{ title: id.products.detail }} />
        <Stack.Screen name="products/[id]/edit" options={{ title: id.products.editPrice }} />
        <Stack.Screen name="products/[id]/count" options={{ title: id.stock.count }} />
        <Stack.Screen name="products/[id]/writeoff" options={{ title: id.stock.writeoffTitle }} />
        <Stack.Screen name="products/new" options={{ title: id.products.add }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <QueryClientProvider client={queryClient}>
          <RootNavigator />
          <StatusBar style="auto" />
        </QueryClientProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
