import { id } from "@kasir/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider, Spinner, useThemeColor } from "heroui-native";
import { useMemo, type JSX, type ReactNode } from "react";
import { useColorScheme, View } from "react-native";
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
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerTransparent: false,
        // Inline titles everywhere. HIG reserves a large title for the root of a
        // section, and every screen behind this stack is a detail or a form
        // pushed from somewhere else; Material 3's top app bar has no large
        // state to lose in the first place.
        headerLargeTitle: false,
      }}
    >
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

/**
 * React Navigation paints the gap between screens with its own theme, not with
 * Tailwind. Left at its default that gap is white, which on iOS 26 shows up as a
 * flash behind the Liquid Glass tab bar in dark mode — the exact symptom the
 * native-tabs docs describe. Feeding it the HeroUI `background` token makes the
 * two agree.
 */
function NavigationTheme({ children }: { children: ReactNode }): JSX.Element {
  const scheme = useColorScheme();
  const [background, surface, foreground, accent, border] = useThemeColor([
    "background",
    "surface",
    "foreground",
    "accent",
    "border",
  ]);
  // A fresh object here would reconcile the whole navigator on every render of
  // this provider, which sits above the entire app.
  const theme = useMemo(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background,
        card: surface,
        text: foreground,
        primary: accent,
        border,
      },
    };
  }, [scheme, background, surface, foreground, accent, border]);

  return <ThemeProvider value={theme}>{children}</ThemeProvider>;
}

export default function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <NavigationTheme>
          <QueryClientProvider client={queryClient}>
            <RootNavigator />
            <StatusBar style="auto" />
          </QueryClientProvider>
        </NavigationTheme>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
